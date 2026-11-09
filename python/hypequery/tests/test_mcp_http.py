"""The self-hosted Streamable HTTP MCP app: the shared fixture and real clients."""

from __future__ import annotations

import contextlib
import json
import socket
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

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
                    content=INITIALIZE,
                )
                assert response.status_code == 503
                assert "secret" not in response.text
                assert "PRIVATE" not in response.text

    anyio.run(run)


# --- Sessions, credentials and CORS: behavior the shared fixture cannot show -----

JSON_HEADERS = {"accept": "application/json, text/event-stream", "content-type": "application/json"}
CLIENT = {"name": "unit", "version": "1"}


def rpc(method: str, request_id: int | None = 1, params: Mapping[str, Any] | None = None) -> bytes:
    message: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        message["id"] = request_id
    message["params"] = params or {}
    return json.dumps(message).encode()


INITIALIZE = rpc(
    "initialize",
    params={"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": CLIENT},
)


def sse_result(text: str) -> Any:
    """The JSON-RPC message in an SSE (or plain JSON) response body."""

    data = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
    return json.loads(data[0] if data else text)


class RecordingExecutor(FakeExecutor):
    """Says which executor answered, and which credentials it was asked with."""

    def __init__(self, label: str, source: Callable[[], Mapping[str, str]]) -> None:
        self.label = label
        self.source = source
        self.seen: list[Mapping[str, str]] = []

    async def list_tools(self) -> dict[str, object]:
        self.seen.append(self.source())
        return {
            "tools": [{"name": self.label, "inputSchema": {"type": "object", "properties": {}}}]
        }


class TokenAuthenticator:
    """Two tokens that name one principal, like two clients of the same user."""

    credential_headers = ("authorization",)

    async def __call__(self, headers: Mapping[str, str]) -> McpPrincipal | None:
        token = headers.get("authorization")
        if token is None:
            return None
        if token not in ("Bearer a", "Bearer b"):
            raise McpAuthError("invalid_token")
        return McpPrincipal(subject="alice", tenant_id="acme")


class Harness:
    """An app over recording executors, driven through ASGI without a socket."""

    def __init__(self, **options: Any) -> None:
        self.executors: list[RecordingExecutor] = []
        self.fail = False
        self.app = create_mcp_asgi_app(self._factory, TokenAuthenticator(), **options)

    async def _factory(
        self, _principal: McpPrincipal, source: Callable[[], Mapping[str, str]]
    ) -> ClientContractExecutor:
        if self.fail:
            raise RuntimeError("backend https://secret.example.test refused PRIVATE_TOKEN")
        self.executors.append(RecordingExecutor(f"executor-{len(self.executors) + 1}", source))
        return self.executors[-1]  # type: ignore[return-value]

    @contextlib.asynccontextmanager
    async def client(self) -> AsyncIterator[httpx2.AsyncClient]:
        async with self.app.run():
            transport = httpx2.ASGITransport(app=self.app)
            async with httpx2.AsyncClient(transport=transport, base_url="http://localhost") as c:
                yield c

    async def post(
        self,
        client: httpx2.AsyncClient,
        body: bytes,
        bearer: str = "a",
        session: str | None = None,
        **extra: str,
    ) -> httpx2.Response:
        headers = {**JSON_HEADERS, "authorization": f"Bearer {bearer}", **extra}
        if session is not None:
            headers["mcp-session-id"] = session
        return await client.post("/mcp", headers=headers, content=body)

    async def open(self, client: httpx2.AsyncClient, bearer: str = "a") -> str:
        response = await self.post(client, INITIALIZE, bearer)
        assert response.status_code == 200
        session = response.headers["mcp-session-id"]
        await self.post(client, rpc("notifications/initialized", None), bearer, session)
        return session

    async def tool(
        self, client: httpx2.AsyncClient, session: str, bearer: str = "a"
    ) -> Mapping[str, Any]:
        response = await self.post(client, rpc("tools/list", 2), bearer, session)
        assert response.status_code == 200
        return sse_result(response.text)  # type: ignore[no-any-return]


def test_each_request_sends_its_own_credentials_never_another_clients() -> None:
    harness = Harness()

    async def run() -> None:
        async with harness.client() as client:
            first = await harness.open(client, "a")
            second = await harness.open(client, "b")
            # Same subject and tenant, so one slot per owner would let the clients overwrite
            # each other; each call must carry the token of the request that made it.
            await harness.tool(client, first, "a")
            await harness.tool(client, second, "b")
            await harness.tool(client, first, "b")
            await harness.tool(client, second, "a")
        one, two = harness.executors
        assert one.seen == [{"authorization": "Bearer a"}, {"authorization": "Bearer b"}]
        assert two.seen == [{"authorization": "Bearer b"}, {"authorization": "Bearer a"}]
        # Outside a request there is nothing to send, so a stray call fails closed.
        assert one.source() == {}

    anyio.run(run)


def test_a_session_keeps_the_executor_it_started_with() -> None:
    harness = Harness()

    async def run() -> None:
        async with harness.client() as client:
            first = await harness.open(client)
            second = await harness.open(client)
            for _ in range(2):
                one = await harness.tool(client, first)
                two = await harness.tool(client, second)
                assert one["result"]["tools"][0]["name"] == "executor-1"
                assert two["result"]["tools"][0]["name"] == "executor-2"
        assert len(harness.executors) == 2

    anyio.run(run)


def test_a_sessionless_request_gets_an_executor_of_its_own_with_its_own_credentials() -> None:
    harness = Harness()
    principal = McpPrincipal(subject="alice", tenant_id="acme")

    class Context:
        def __init__(self, token: str) -> None:
            credentials = {"authorization": f"Bearer {token}"}
            self.request = SimpleNamespace(
                scope={
                    "hypequery.mcp.principal": principal,
                    "hypequery.mcp.credentials": credentials,
                },
                headers={},
            )

    async def run() -> None:
        async with harness.app.run():
            one = await harness.app._resolve(Context("a"))
            two = await harness.app._resolve(Context("b"))
            first = cast(RecordingExecutor, one.executor)
            second = cast(RecordingExecutor, two.executor)
            assert first is not second
            with one.bind():
                assert first.source() == {"authorization": "Bearer a"}
            with two.bind():
                assert second.source() == {"authorization": "Bearer b"}
            # Nothing is kept: no session, and nothing shared between the requests.
            assert harness.app._sessions == {}
            with one.bind(), two.bind():
                assert second.source() == {"authorization": "Bearer b"}

    anyio.run(run)


def test_nothing_is_built_or_kept_for_a_request_that_does_not_open_a_session() -> None:
    harness = Harness(max_request_body_size=512)

    async def run() -> None:
        async with harness.client() as client:
            not_initialize = await harness.post(client, rpc("tools/list"))
            assert not_initialize.status_code == 400
            malformed = await harness.post(client, b"{not json")
            assert malformed.status_code == 400
            oversized = await harness.post(client, INITIALIZE + b" " * 1024)
            assert oversized.status_code == 413
            harness.fail = True
            unservable = await harness.post(client, INITIALIZE)
            assert unservable.status_code == 503
            assert "secret" not in unservable.text
            assert "PRIVATE" not in unservable.text
        assert harness.executors == []
        assert harness.app._sessions == {}

    anyio.run(run)


def test_a_burst_of_openings_cannot_start_more_discoveries_than_there_is_room_for() -> None:
    gate = anyio.Event()
    started = 0

    async def slow(_principal: McpPrincipal, source: Callable[[], Mapping[str, str]]) -> Any:
        nonlocal started
        started += 1
        await gate.wait()
        return RecordingExecutor(f"executor-{started}", source)

    app = create_mcp_asgi_app(slow, TokenAuthenticator(), max_sessions=2)

    async def run() -> None:
        statuses: list[int] = []

        async def open_one(client: httpx2.AsyncClient) -> None:
            headers = {**JSON_HEADERS, "authorization": "Bearer a"}
            response = await client.post("/mcp", headers=headers, content=INITIALIZE)
            statuses.append(response.status_code)

        async with app.run():
            transport = httpx2.ASGITransport(app=app)
            async with (
                httpx2.AsyncClient(transport=transport, base_url="http://localhost") as c,
                anyio.create_task_group() as tasks,
            ):
                for _ in range(6):
                    tasks.start_soon(open_one, c)
                # What fits has started; the rest was refused before the backend was asked.
                with anyio.fail_after(10):
                    while started < 2 or statuses.count(503) < 4:
                        await anyio.sleep(0.01)
                assert started == 2
                gate.set()
        assert sorted(statuses) == [200, 200, 503, 503, 503, 503]
        assert app._opening == 0

    anyio.run(run)


def test_a_failed_discovery_releases_its_slot() -> None:
    harness = Harness(max_sessions=1)

    async def run() -> None:
        async with harness.client() as client:
            harness.fail = True
            assert (await harness.post(client, INITIALIZE)).status_code == 503
            harness.fail = False
            # The failure did not leave the only slot reserved.
            assert (await harness.post(client, INITIALIZE)).status_code == 200
        assert harness.app._opening == 0

    anyio.run(run)


def test_a_refused_opening_request_leaves_no_executor_behind() -> None:
    harness = Harness(max_sessions=1)

    async def run() -> None:
        async with harness.client() as client:
            await harness.open(client)
            refused = await harness.post(client, INITIALIZE)
            assert refused.status_code == 503
            # The app is full, so it did not even ask the backend.
            assert len(harness.executors) == 1
            # A request the SDK itself refuses (no Accept) is not kept either.
            bad = await client.post(
                "/mcp",
                headers={"authorization": "Bearer a", "content-type": "application/json"},
                content=INITIALIZE,
            )
            assert bad.status_code != 200
            assert len(harness.app._sessions) == 1

    anyio.run(run)


def test_a_session_is_forgotten_when_it_ends_and_never_silently_rebuilt() -> None:
    harness = Harness()

    async def run() -> None:
        async with harness.client() as client:
            deleted = await harness.open(client)
            await client.delete(
                "/mcp", headers={"authorization": "Bearer a", "mcp-session-id": deleted}
            )
            assert deleted not in harness.app._sessions

            idle = await harness.open(client)
            # The SDK has not expired it, but this app has dropped its executor.
            harness.app._sessions[idle].last_used -= 10_000
            kept = await harness.open(client)
            assert idle not in harness.app._sessions
            assert kept in harness.app._sessions
            reply = await harness.tool(client, idle)
            assert "reconnect" in reply["error"]["message"]
            assert len(harness.executors) == 3

    anyio.run(run)


def test_a_session_with_a_request_in_flight_is_never_idle() -> None:
    harness = Harness()

    async def run() -> None:
        async with harness.client() as client:
            session = await harness.open(client)
            held = harness.app._sessions[session]
            held.last_used -= 10_000
            held.active = 1
            harness.app._sweep()
            assert session in harness.app._sessions

    anyio.run(run)


def test_stopping_the_app_drops_every_session() -> None:
    harness = Harness()

    async def run() -> None:
        async with harness.client() as client:
            await harness.open(client)
            assert len(harness.app._sessions) == 1
        assert harness.app._sessions == {}

    anyio.run(run)


ORIGIN = "https://app.example.test"
CORS = {"origin": ORIGIN}


def test_an_allowed_browser_page_can_preflight_call_and_read_replies() -> None:
    harness = Harness(allowed_origins=(ORIGIN,))

    async def run() -> None:
        async with harness.client() as client:
            preflight = await client.options(
                "/mcp",
                headers={
                    **CORS,
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "authorization, content-type",
                },
            )
            # No credential is sent on a preflight, so it is answered before authentication.
            assert preflight.status_code == 204
            assert preflight.headers["access-control-allow-origin"] == ORIGIN
            allowed = preflight.headers["access-control-allow-headers"].split(", ")
            assert {"authorization", "content-type", "mcp-session-id"} <= set(allowed)
            assert preflight.headers["access-control-allow-methods"] == "GET, POST, DELETE, OPTIONS"

            opened = await harness.post(client, INITIALIZE, **CORS)
            assert opened.headers["access-control-allow-origin"] == ORIGIN
            exposed = opened.headers["access-control-expose-headers"].split(", ")
            assert exposed == ["mcp-session-id", "www-authenticate"]

            challenge = await client.post("/mcp", headers={**JSON_HEADERS, **CORS}, content=b"{}")
            assert challenge.status_code == 401
            assert challenge.headers["access-control-allow-origin"] == ORIGIN

            other = await client.options("/mcp", headers={"origin": "https://evil.example.test"})
            assert other.status_code == 403
            assert "access-control-allow-origin" not in other.headers

            bare = await client.options("/mcp")
            assert bare.status_code == 405

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


def test_an_oauth_resource_must_be_the_only_accepted_audience() -> None:
    resource = ProtectedResource(
        resource="https://mcp.example.test/mcp",
        authorization_servers=("https://auth.example.test",),
    )

    def check(**audience: Any) -> None:
        api = create_api(auth=jwt_strategy(secret="s" * 32, **audience))
        check_resource_audience(ApiAuthenticator(api), resource)

    check(audience="https://mcp.example.test/mcp")
    check(audience=("https://mcp.example.test/mcp", "https://mcp.example.test/mcp"))
    # A token naming only the other API passes a strategy that accepts either, so it must refuse.
    with pytest.raises(ValueError, match="must accept only audience"):
        check(audience="https://other.example.test/mcp")
    with pytest.raises(ValueError, match=r"https://api\.example\.test"):
        check(audience=("https://mcp.example.test/mcp", "https://api.example.test"))
    with pytest.raises(ValueError, match="any audience"):
        check()


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
