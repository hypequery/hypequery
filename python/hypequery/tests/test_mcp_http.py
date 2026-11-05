"""The self-hosted Streamable HTTP MCP app: the shared fixture and real clients."""

from __future__ import annotations

import contextlib
import json
import socket
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any

import anyio
import pytest

from mcp_support import READER, build_api

pytest.importorskip("mcp", reason="the mcp extra is not installed")

import httpx2
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from hypequery.mcp import (
    ApiAuthenticator,
    ApiExecutorFactory,
    ClientContractExecutor,
    McpAuthError,
    McpPrincipal,
    ProtectedResource,
    check_resource_audience,
    create_mcp_asgi_app,
    static_key_authenticator,
)
from hypequery.mcp.server import McpAsgiApp
from hypequery.serve import create_api, jwt_strategy

FIXTURE = json.loads(
    (Path(__file__).parents[3] / "specs/mcp/http-transport-v1/cases.json").read_text("utf-8")
)
FIXTURE_IDS = [case["id"] for case in FIXTURE["cases"]]


class FakeExecutor:
    """Stands in for a `ClientContractExecutor`: the fixture pins HTTP, not tools."""

    invalidated = False

    async def list_tools(self) -> dict[str, object]:
        return {"tools": []}

    async def list_prompts(self) -> dict[str, object]:
        return {"prompts": []}


async def fake_factory(_principal: McpPrincipal, _credentials: Any) -> ClientContractExecutor:
    return FakeExecutor()  # type: ignore[return-value]


def fixture_app(profile: Mapping[str, Any]) -> McpAsgiApp:
    auth = profile["auth"]
    resource = None
    if "oauth" in profile:
        oauth = profile["oauth"]
        resource = ProtectedResource(
            resource=oauth["resource"],
            authorization_servers=tuple(oauth["authorizationServers"]),
            scopes_supported=tuple(oauth["scopesSupported"]),
            required_scopes=tuple(oauth["requiredScopes"]),
        )
    if auth["kind"] == "static-key":
        authenticate: Any = static_key_authenticator(auth["key"])
    else:
        # The API's own jwt_strategy verifies the token; its default claim
        # mapping takes `org_id` as the tenant, as the fixture expects.
        assert auth["tenantClaim"] == "org_id"
        api = create_api(
            auth=jwt_strategy(
                secret=auth["secret"],
                issuer=auth["issuer"],
                audience=auth["audience"],
                algorithms=(auth["algorithm"],),
            )
        )
        authenticate = ApiAuthenticator(api)
        check_resource_audience(authenticate, resource)
    return create_mcp_asgi_app(
        fake_factory,
        authenticate,
        path=profile["path"],
        allowed_hosts=profile["allowedHosts"],
        allowed_origins=profile["allowedOrigins"],
        protected_resource=resource,
    )


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=FIXTURE_IDS)
def test_http_transport_fixture(case: Mapping[str, Any]) -> None:
    assert FIXTURE["version"] == 1
    app = fixture_app(FIXTURE["profiles"][case["profile"]])

    async def run() -> None:
        sessions: list[str | None] = []
        async with app.run():
            transport = httpx2.ASGITransport(app=app)
            base = "http://mcp.example.test"
            async with httpx2.AsyncClient(transport=transport, base_url=base) as client:
                for index, step in enumerate(case["steps"]):
                    request = step["request"]
                    headers = dict(request["headers"])
                    if "session" in request:
                        headers["mcp-session-id"] = sessions[request["session"]] or ""
                    body = request.get("body")
                    response = await client.request(
                        request["method"],
                        request["path"],
                        headers=headers,
                        content=None if body is None else json.dumps(body).encode(),
                    )
                    sessions.append(response.headers.get("mcp-session-id"))
                    expect = step["expect"]
                    assert response.status_code == expect["status"], (index, response.text)
                    for name, value in expect.get("headers", {}).items():
                        assert response.headers.get(name) == value, (index, name)
                    if "json" in expect:
                        assert response.json() == expect["json"]
                    if expect.get("session"):
                        session = response.headers.get("mcp-session-id") or ""
                        assert len(session) == 32
                        assert int(session, 16) >= 0

    anyio.run(run)


@contextlib.asynccontextmanager
async def listening(app: McpAsgiApp) -> AsyncIterator[str]:
    """Serve *app* on a free loopback port with a real ASGI server."""

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.serve)
        while not server.started:
            await anyio.sleep(0.01)
        try:
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True


async def connect(url: str, headers: Mapping[str, str]) -> Any:
    http = httpx2.AsyncClient(headers=dict(headers), timeout=10)
    return http, streamable_http_client(f"{url}/mcp", http_client=http)


def test_an_api_is_served_over_http_with_its_own_auth_and_tenancy() -> None:
    api, executor = build_api()
    app = create_mcp_asgi_app(
        ApiExecutorFactory(api), ApiAuthenticator(api), allowed_hosts=("127.0.0.1",)
    )

    async def run() -> None:
        async with listening(app) as url:
            http, transport = await connect(url, READER)
            async with http, Client(transport) as client:
                tools = await client.list_tools()
                assert [tool.name for tool in tools.tools] == [
                    "list_datasets",
                    "get_dataset_schema",
                    "query_metric",
                    "query_dataset",
                ]
                result = await client.call_tool(
                    "query_dataset", {"dataset": "orders", "dimensions": ["country"]}
                )
                assert not result.is_error
            # The API's own pipeline ran the query, scoped to the reader's tenant.
            assert executor.seen
            assert all("tenant_id" in query.sql for query in executor.seen)

            async with httpx2.AsyncClient() as plain:
                refused = await plain.post(f"{url}/mcp", headers={"authorization": "Bearer nobody"})
            assert refused.status_code == 401
            assert refused.headers["www-authenticate"] == 'Bearer error="invalid_token"'

    anyio.run(run)


def test_a_static_key_guards_one_backend_principal() -> None:
    api, _ = build_api()
    key = "python-static-key-0123456789"
    app = create_mcp_asgi_app(
        ApiExecutorFactory(api, headers=READER),
        static_key_authenticator(key),
        allowed_hosts=("127.0.0.1",),
    )

    async def run() -> None:
        async with listening(app) as url:
            http, transport = await connect(url, {"authorization": f"Bearer {key}"})
            async with http, Client(transport) as client:
                result = await client.call_tool("list_datasets", {})
                assert not result.is_error

    anyio.run(run)


def test_an_unservable_backend_is_refused_without_details() -> None:
    async def failing(_principal: McpPrincipal, _credentials: Callable[[], Any]) -> Any:
        raise RuntimeError("backend https://secret.example.test refused PRIVATE_TOKEN")

    app = create_mcp_asgi_app(failing, static_key_authenticator("k" * 20))

    async def run() -> None:
        async with app.run():
            transport = httpx2.ASGITransport(app=app)
            base = "http://localhost"
            async with httpx2.AsyncClient(transport=transport, base_url=base) as client:
                response = await client.post(
                    "/mcp",
                    headers={
                        "authorization": "Bearer " + "k" * 20,
                        "accept": "application/json, text/event-stream",
                        "content-type": "application/json",
                    },
                    content=b"{}",
                )
                assert response.status_code == 503
                assert "secret" not in response.text
                assert "PRIVATE" not in response.text

    anyio.run(run)


def test_a_new_session_never_inherits_an_invalidated_executor() -> None:
    built: list[FakeExecutor] = []

    async def factory(_principal: McpPrincipal, _credentials: Any) -> Any:
        built.append(FakeExecutor())
        return built[-1]

    app = create_mcp_asgi_app(factory, static_key_authenticator("k" * 20))
    principal = McpPrincipal(subject="static-key")

    async def run() -> None:
        first = await app._session_executor("one", principal)
        assert await app._session_executor("one", principal) is first
        built[0].invalidated = True
        # The old session keeps its executor, so its calls keep failing closed...
        assert await app._session_executor("one", principal) is first
        # ...and a new session gets a fresh one.
        second = await app._session_executor("two", principal)
        assert second is not first
        assert len(built) == 2

    anyio.run(run)


def test_configuration_is_validated() -> None:
    with pytest.raises(ValueError, match="absolute path"):
        create_mcp_asgi_app(fake_factory, static_key_authenticator("k" * 20), path="mcp")
    with pytest.raises(ValueError, match="positive integer"):
        create_mcp_asgi_app(fake_factory, static_key_authenticator("k" * 20), max_sessions=0)
    with pytest.raises(ValueError, match="bare origins"):
        create_mcp_asgi_app(
            fake_factory, static_key_authenticator("k" * 20), allowed_origins=("https://a/b",)
        )
    with pytest.raises(ValueError, match="at least 16"):
        static_key_authenticator("short")
    with pytest.raises(ValueError, match="https"):
        ProtectedResource(
            resource="http://mcp.example.test/mcp", authorization_servers=("https://a",)
        )
    with pytest.raises(ValueError, match="scope tokens"):
        ProtectedResource(
            resource="https://mcp.example.test/mcp",
            authorization_servers=("https://a",),
            scopes_supported=("bad scope",),
        )


def test_an_oauth_resource_must_be_an_accepted_audience() -> None:
    api = create_api(auth=jwt_strategy(secret="s" * 32, audience="https://other.example.test/mcp"))
    resource = ProtectedResource(
        resource="https://mcp.example.test/mcp",
        authorization_servers=("https://auth.example.test",),
    )
    with pytest.raises(ValueError, match="must accept audience"):
        check_resource_audience(ApiAuthenticator(api), resource)


def test_context_strategies_cannot_serve_mcp_over_http() -> None:
    from hypequery.serve import from_context

    api = create_api(auth=from_context(lambda request: None))
    with pytest.raises(ValueError, match="header credential"):
        ApiAuthenticator(api)


def test_auth_errors_carry_only_their_code() -> None:
    error = McpAuthError("insufficient_scope", "secret detail", scopes=("read",))
    assert error.code == "insufficient_scope"
    assert error.scopes == ("read",)
    assert "alice" not in repr(McpPrincipal(subject="alice@example.com"))
