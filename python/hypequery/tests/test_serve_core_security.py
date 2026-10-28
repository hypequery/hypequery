"""The core's HTTP security profile answers exactly as the FastAPI layer does.

Decision 0023 step 2 moved trusted hosts, proxy trust, CORS, rate limits and
production budgets into the core. Every request below is sent both to a FastAPI
application with the profile installed and to `Api.handle` with the same
profile, and the two answers must match: status, headers and body.

Both of those now run the core's own policies, so the CORS and trusted-host
answers are also checked against an independent reference: Starlette's
`CORSMiddleware` and `TrustedHostMiddleware`, configured as the FastAPI layer
configured them before the move.
"""

from __future__ import annotations

import asyncio
import threading

import httpx
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from core_transport import CoreClient
from hypequery.serve import (
    CorsPolicy,
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    RateLimit,
    bearer_token,
    create_router,
    default_tenant_resolver,
    install_http_security,
)
from hypequery.serve.core import Api, Call, ServeRequest, ServeResponse
from hypequery.serve.core.authentication import Authentication
from hypequery.serve.core.messages import Headers
from hypequery.serve.core.rate_limit import RateLimit as CoreRateLimit

PROFILES = {
    "hosts": HttpSecurity(allowed_hosts=("testserver", "*.example.com", "[::1]")),
    "cors": HttpSecurity(
        allowed_hosts=("testserver",),
        cors=CorsPolicy(origins=("https://a.test", "http://b.test:3000")),
    ),
    "cors-credentials": HttpSecurity(
        allowed_hosts=("testserver",),
        cors=CorsPolicy(
            origins=("https://a.test",),
            allow_credentials=True,
            allow_headers=("Authorization", "X-Custom"),
            max_age=60,
        ),
    ),
    "cors-any": HttpSecurity(allowed_hosts=("testserver",), cors=CorsPolicy(origins=("*",))),
    "proxies": HttpSecurity(
        allowed_hosts=("testserver",), trusted_proxies=("10.0.0.0/8", "127.0.0.1")
    ),
}
PEERS = {"direct": ("testclient", 50000), "via-proxy": ("10.0.0.5", 1)}

AUTH = {"authorization": "Bearer token"}
REQUESTS: list[tuple[str, str, dict[str, str]]] = [
    ("GET", "/private", {}),
    ("GET", "/private", AUTH),
    ("GET", "/public", {}),
    ("GET", "/missing", {}),
    ("POST", "/private", AUTH),
    ("GET", "/private", {**AUTH, "x-request-id": "abc-1"}),
    ("GET", "/private", {**AUTH, "x-request-id": "not valid"}),
    ("GET", "/private", {**AUTH, "host": "evil.test"}),
    ("GET", "/private", {**AUTH, "host": "api.example.com"}),
    ("GET", "/private", {**AUTH, "host": "testserver:99999"}),
    ("GET", "/private", {**AUTH, "host": "test server"}),
    ("GET", "/private", {**AUTH, "host": "[::1]:8000"}),
    ("GET", "/private", {**AUTH, "origin": "https://a.test"}),
    ("GET", "/private", {**AUTH, "origin": "https://evil.test"}),
    ("GET", "/private", {"origin": "http://b.test:3000"}),
    ("OPTIONS", "/private", {"origin": "https://a.test", "access-control-request-method": "GET"}),
    (
        "OPTIONS",
        "/private",
        {
            "origin": "https://evil.test",
            "access-control-request-method": "PUT",
            "access-control-request-headers": "X-Other, Authorization",
        },
    ),
    (
        "OPTIONS",
        "/missing",
        {
            "origin": "https://a.test",
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization,content-type",
            "access-control-request-private-network": "true",
        },
    ),
    (
        "OPTIONS",
        "/private",
        {
            "origin": "http://b.test:3000",
            "access-control-request-method": "GET",
            "access-control-request-headers": "x-custom",
        },
    ),
    ("OPTIONS", "/private", {"origin": "https://a.test"}),
    ("GET", "/limited", {}),
    ("GET", "/limited", {}),
    ("GET", "/limited", {"x-forwarded-for": "1.2.3.4"}),
    ("GET", "/limited", {"x-forwarded-for": "5.6.7.8", "x-forwarded-proto": "https"}),
    ("GET", "/limited", {"x-forwarded-for": "5.6.7.8, 10.1.1.1"}),
    ("GET", "/limited", {"x-forwarded-for": "unknown"}),
    ("GET", "/limited", {"x-forwarded-for": "unknown", "origin": "https://a.test"}),
    ("GET", "/limited", {**AUTH}),
    ("GET", "/limited", {**AUTH}),
]


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="alice") if credential.value == "token" else None


def _fastapi(security: HttpSecurity) -> FastAPI:
    router = create_router(authenticate=_authenticate)

    @router.get("/private")
    def private() -> dict[str, bool]:
        return {"ok": True}

    @router.get("/public")
    @router.public
    def public() -> dict[str, bool]:
        return {"ok": True}

    @router.get("/limited", dependencies=[Depends(RateLimit(max=1, window_seconds=60))])
    @router.public
    def limited() -> dict[str, bool]:
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    install_http_security(app, security)
    return app


def _core(security: HttpSecurity, production: ProductionProfile | None = None) -> Api:
    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    api = Api(
        authentication=Authentication(_authenticate, bearer_token(), default_tenant_resolver),
        security=security,
        production=production,
    )
    api.add_route("GET", "/private", ok)
    api.add_route("GET", "/public", ok, public=True)
    api.add_route(
        "GET", "/limited", ok, public=True, limits=[CoreRateLimit(max=1, window_seconds=60)]
    )
    return api


def _answer(response: httpx.Response) -> tuple[int, dict[str, str], bytes]:
    headers = {
        name: value
        for name, value in response.headers.items()
        # The request id is random; content-length is the transport's.
        if name not in ("x-request-id", "content-length")
    }
    return response.status_code, headers, response.content


@pytest.mark.parametrize("peer", sorted(PEERS))
@pytest.mark.parametrize("profile", sorted(PROFILES))
def test_core_security_matches_the_fastapi_layer(profile: str, peer: str) -> None:
    security = PROFILES[profile]
    expected = TestClient(_fastapi(security), client=PEERS[peer])
    core = CoreClient(_core(security), client=PEERS[peer])
    for method, path, headers in REQUESTS:
        fastapi_answer = _answer(expected.request(method, path, headers=headers))
        assert _answer(core.request(method, path, headers=headers)) == fastapi_answer, (
            method,
            path,
            headers,
        )


#: Requests whose answer the CORS and trusted-host policies decide, on a public
#: route, so authentication plays no part. Malformed raw `Host` values are
#: hypequery's own check, not Starlette's, and are asserted separately below.
REFERENCE_REQUESTS = [
    (method, "/public", headers)
    for method, path, headers in REQUESTS
    if ((path == "/private" and method == "GET") or method == "OPTIONS")
    and headers.get("host") not in ("testserver:99999", "test server")
]


def _starlette_reference(security: HttpSecurity) -> Starlette:
    """The policies as Starlette's middleware applied them before the move to the core."""

    async def ok(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok")

    middleware = [
        Middleware(
            TrustedHostMiddleware,
            allowed_hosts=list(security.allowed_hosts),
            www_redirect=False,
        )
    ]
    cors = security.cors
    if cors is not None:
        middleware.append(
            Middleware(
                CORSMiddleware,
                allow_origins=list(cors.origins),
                allow_credentials=cors.allow_credentials,
                allow_methods=list(cors.allow_methods),
                allow_headers=list(cors.allow_headers),
                expose_headers=["x-request-id", "x-correlation-id"],
                max_age=cors.max_age,
            )
        )
    return Starlette(routes=[Route("/public", ok, methods=["GET"])], middleware=middleware)


def _core_reference(security: HttpSecurity) -> CoreClient:
    async def ok(call: Call) -> ServeResponse:
        return ServeResponse(
            status=200, headers={"content-type": "text/plain; charset=utf-8"}, body=b"ok"
        )

    api = Api(
        authentication=Authentication(_authenticate, bearer_token(), default_tenant_resolver),
        security=security,
    )
    api.add_route("GET", "/public", ok, public=True)
    return CoreClient(api)


def _policy_answer(response: httpx.Response) -> tuple[int, list[tuple[str, str]], bytes]:
    # Request ids are hypequery's, not Starlette's; the parity test covers them.
    headers = [
        (name, value)
        for name, value in response.headers.multi_items()
        if name not in ("x-request-id", "x-correlation-id", "content-length")
    ]
    return response.status_code, headers, response.content


@pytest.mark.parametrize("profile", sorted(PROFILES))
def test_core_security_matches_starlettes_middleware(profile: str) -> None:
    security = PROFILES[profile]
    reference = TestClient(_starlette_reference(security))
    core = _core_reference(security)
    for method, path, headers in REFERENCE_REQUESTS:
        if method == "OPTIONS" and not (
            security.cors is not None and "access-control-request-method" in headers
        ):
            # Not a preflight the policy answers: routing decides, and the two
            # routers differ there (404 against Starlette's 405).
            continue
        expected = _policy_answer(reference.request(method, path, headers=headers))
        assert _policy_answer(core.request(method, path, headers=headers)) == expected, (
            method,
            headers,
        )


@pytest.mark.parametrize("host", ["testserver:99999", "test server", "a:1:2", ""])
def test_core_refuses_a_malformed_raw_host(host: str) -> None:
    response = _core_reference(PROFILES["hosts"]).request("GET", "/public", headers={"host": host})
    assert response.status_code == 400
    assert response.text == "Invalid host header"
    assert response.headers["content-type"] == "text/plain; charset=utf-8"


def test_core_resolves_the_client_through_trusted_proxies_only() -> None:
    seen: list[tuple[str, int] | None] = []

    async def record(call: Call) -> ServeResponse:
        seen.append(call.request.client)
        return ServeResponse.json({})

    api = Api(
        authentication=Authentication(_authenticate, bearer_token(), default_tenant_resolver),
        security=PROFILES["proxies"],
    )
    api.add_route("GET", "/who", record, public=True)
    forwarded = {"x-forwarded-for": "1.2.3.4, 10.2.2.2"}
    CoreClient(api, client=("10.0.0.5", 1)).request("GET", "/who", headers=forwarded)
    CoreClient(api, client=("8.8.8.8", 1)).request("GET", "/who", headers=forwarded)
    CoreClient(api, client=("10.0.0.5", 1)).request(
        "GET", "/who", headers={"x-forwarded-for": "unknown"}
    )
    assert seen == [("1.2.3.4", 0), ("8.8.8.8", 1), ("10.0.0.5", 1)]


def test_core_without_security_serves_any_host() -> None:
    open_api = Api(
        authentication=Authentication(_authenticate, bearer_token(), default_tenant_resolver)
    )

    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    open_api.add_route("GET", "/public", ok, public=True)
    response = CoreClient(open_api).request("GET", "/public", headers={"host": "anything.test"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def _request(path: str) -> ServeRequest:
    return ServeRequest(method="GET", path=path, headers=Headers([("host", "testserver")]))


def _send(api: Api, path: str) -> ServeResponse:
    return asyncio.run(api.handle(_request(path)))


def test_core_production_refuses_a_response_over_its_byte_ceiling() -> None:
    api = _core(PROFILES["hosts"], ProductionProfile(max_result_bytes=1024))

    async def big(call: Call) -> ServeResponse:
        return ServeResponse.json({"x": "y" * 2000})

    api.add_route("GET", "/big", big, public=True)
    response = _send(api, "/big")
    assert response.status == 413
    assert b'"PAYLOAD_TOO_LARGE"' in response.body
    assert b"y" * 100 not in response.body


def test_core_production_times_out_and_cancels_the_request_work() -> None:
    states = []

    def blocked(cancellation: threading.Event) -> None:
        cancellation.wait(5)

    async def slow(call: Call) -> ServeResponse:
        states.append(call.state)
        await call.state.work.start_sync(blocked, call.state.work.cancellation)
        return ServeResponse.json({})

    api = _core(PROFILES["hosts"], ProductionProfile(timeout_seconds=1))
    api.add_route("GET", "/slow", slow, public=True)

    async def run() -> tuple[ServeResponse, int]:
        response = await api.handle(_request("/slow"))
        await states[0].work.drain()
        await asyncio.sleep(0)
        return response, api._gate.active if api._gate is not None else -1

    response, active = asyncio.run(run())
    assert response.status == 504
    assert b'"GATEWAY_TIMEOUT"' in response.body
    assert states[0].work.cancellation.is_set()
    assert active == 0


def test_core_production_refuses_requests_over_its_concurrency() -> None:
    api = _core(PROFILES["hosts"], ProductionProfile(max_concurrency=1))
    started, release = asyncio.Event(), asyncio.Event()

    async def hold(call: Call) -> ServeResponse:
        started.set()
        await release.wait()
        return ServeResponse.json({"held": True})

    api.add_route("GET", "/hold", hold, public=True)
    request = _request("/hold")

    async def run() -> list[ServeResponse]:
        first = asyncio.create_task(api.handle(request))
        await started.wait()
        refused = await api.handle(request)
        release.set()
        return [await first, refused, await api.handle(request)]

    held, refused, after = asyncio.run(run())
    assert held.status == 200
    assert refused.status == 503
    assert b"The server is at capacity." in refused.body
    assert after.status == 200
