"""PYD-03: the HTTP security profile, one control at a time.

Router controls are always on: bounded JSON bodies and `no-store` on
authenticated responses. Application controls come from `HttpSecurity`:
trusted hosts, CORS, proxy trust, and request identifiers. A configuration
that cannot be safe fails when it is built.
"""

# No `from __future__ import annotations`: FastAPI resolves endpoint
# annotations at registration, and these endpoints close over local routers.
import asyncio
import re
from collections.abc import Callable
from typing import Annotated, Any

import httpx
import pytest
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse

from hypequery.serve import (
    MAX_CORRELATION_ID_BYTES,
    CorsPolicy,
    Credential,
    HttpSecurity,
    Principal,
    RequestAuth,
    create_router,
    install_http_security,
    request_id,
    sanitize_correlation_id,
)

TOKEN = "good-token"  # noqa: S105 - a test credential
AUTH = {"Authorization": f"Bearer {TOKEN}"}
REQUEST_ID = re.compile(r"[0-9a-f]{32}")


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="alice", tenant_id="acme") if credential.value == TOKEN else None


def _app(security: HttpSecurity | None = None, *, max_body_bytes: int = 64) -> FastAPI:
    router = create_router(authenticate=_authenticate, max_body_bytes=max_body_bytes)

    @router.post("/echo")
    def echo(
        auth: Annotated[RequestAuth, Depends(router.auth)],
        payload: Annotated[dict[str, Any], Body()],
    ) -> dict[str, Any]:
        return payload

    @router.get("/cacheable")
    def cacheable() -> JSONResponse:
        return JSONResponse({"ok": True}, headers={"Cache-Control": "public, max-age=3600"})

    @router.get("/error")
    def error() -> None:
        raise HTTPException(403, detail="private error")

    @router.post("/public-echo")
    @router.public
    def public_echo(payload: Annotated[dict[str, Any], Body()]) -> dict[str, Any]:
        return payload

    @router.get("/ids")
    @router.public
    def ids(request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "request_id": request_id(request),
                "client": request.client and request.client.host,
                "scheme": request.url.scheme,
            },
            headers={"x-request-id": "set-by-handler", "x-correlation-id": "set-by-handler"},
        )

    app = FastAPI()
    app.include_router(router)
    if security is not None:
        install_http_security(app, security)
    return app


def _asgi(
    app: FastAPI,
    headers: list[tuple[str, str]],
    *,
    client: tuple[str, int] = ("203.0.113.9", 5000),
    path: str = "/ids",
) -> httpx.Response:
    async def call() -> httpx.Response:
        transport = httpx.ASGITransport(app=app, client=client)
        async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as http:
            return await http.get(path, headers=headers)

    return asyncio.run(call())


SECURE = HttpSecurity(allowed_hosts=("api.test", "testserver"))


# --- router: bodies -------------------------------------------------------


def test_a_declared_oversized_body_is_refused_after_authentication() -> None:
    client = TestClient(_app())
    body = b'{"a": "' + b"x" * 100 + b'"}'

    anonymous = client.post("/echo", content=body, headers={"Content-Type": "application/json"})
    assert anonymous.status_code == 401

    response = client.post(
        "/echo", content=body, headers={**AUTH, "Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["error"]["type"] == "PAYLOAD_TOO_LARGE"


def test_a_streamed_body_is_counted_without_a_content_length() -> None:
    client = TestClient(_app())

    def chunks() -> Any:
        yield b'{"a": "'
        yield b"x" * 100
        yield b'"}'

    response = client.post(
        "/echo", content=chunks(), headers={**AUTH, "Content-Type": "application/json"}
    )
    assert "content-length" not in response.request.headers
    assert response.status_code == 413


@pytest.mark.parametrize(
    "content_type",
    [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "application/json; charset=latin-1",
        "application/jsonp",
        "",
    ],
)
def test_a_body_that_is_not_utf8_json_is_refused(content_type: str) -> None:
    client = TestClient(_app())
    headers = {**AUTH, "Content-Type": content_type} if content_type else AUTH

    response = client.post("/echo", content=b'{"a": 1}', headers=headers)
    assert response.status_code == 415


@pytest.mark.parametrize(
    "content_type",
    ["application/json", "Application/JSON; charset=UTF-8", "application/json;charset=utf-8"],
)
def test_utf8_json_is_accepted(content_type: str) -> None:
    client = TestClient(_app())

    response = client.post(
        "/echo", content=b'{"a": 1}', headers={**AUTH, "Content-Type": content_type}
    )
    assert response.status_code == 200
    assert response.json() == {"a": 1}


def _raw(
    app: FastAPI,
    path: str,
    headers: list[tuple[bytes, bytes]],
    body: bytes = b"",
    method: str = "POST",
) -> tuple[int, dict[bytes, bytes]]:
    """Drive the ASGI app directly, for headers an HTTP client will not send."""

    sent: list[dict[str, Any]] = []
    messages = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive() -> dict[str, Any]:
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"api.test"), *headers],
        "client": ("203.0.113.9", 5000),
        "server": ("api.test", 80),
    }
    asyncio.run(app(scope, receive, send))  # type: ignore[arg-type]
    return int(sent[0]["status"]), {name.lower(): value for name, value in sent[0]["headers"]}


@pytest.mark.parametrize(
    "lengths", [[b"2", b"2"], [b"-1"], [b"0x2"], ["٢".encode()], [b"2 "], [b"+2"]]
)
def test_an_ambiguous_content_length_is_refused(lengths: list[bytes]) -> None:
    headers = [(b"content-type", b"application/json")]
    headers += [(b"content-length", value) for value in lengths]

    assert _raw(_app(max_body_bytes=1_000), "/public-echo", headers, b"{}")[0] == 400


def test_a_plain_content_length_is_accepted() -> None:
    headers = [(b"content-type", b"application/json"), (b"content-length", b"2")]

    assert _raw(_app(max_body_bytes=1_000), "/public-echo", headers, b"{}")[0] == 200


def test_a_headerless_body_still_requires_json() -> None:
    assert _raw(_app(), "/public-echo", [], b"{}")[0] == 415
    assert _raw(_app(), "/public-echo", [(b"content-type", b"application/json")], b"{}")[0] == 200


def test_public_routes_have_the_body_policy_but_keep_their_cache_headers() -> None:
    client = TestClient(_app())

    assert (
        client.post(
            "/public-echo", content=b"x" * 100, headers={"Content-Type": "application/json"}
        ).status_code
        == 413
    )
    assert (
        client.post(
            "/public-echo", content=b"{}", headers={"Content-Type": "text/plain"}
        ).status_code
        == 415
    )
    ok = client.post("/public-echo", json={"a": 1})
    assert ok.status_code == 200
    assert "cache-control" not in ok.headers


def test_an_authenticated_response_is_never_stored() -> None:
    client = TestClient(_app())

    for response in (
        client.get("/cacheable", headers=AUTH),
        client.post("/echo", json={"a": 1}, headers=AUTH),
    ):
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"


def test_an_authenticated_endpoint_error_is_never_stored() -> None:
    response = TestClient(_app()).get("/error", headers=AUTH)

    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"

    validation_error = TestClient(_app()).post(
        "/echo", content=b"{", headers={**AUTH, "Content-Type": "application/json"}
    )
    # 400, not FastAPI's 422: the canonical envelope matches TypeScript serve.
    assert validation_error.status_code == 400
    assert validation_error.json()["error"]["type"] == "VALIDATION_ERROR"
    assert validation_error.headers["cache-control"] == "no-store"


def test_create_router_validates_the_body_limit() -> None:
    for bad in (0, -1, 1.5, True):
        with pytest.raises(ValueError, match="max_body_bytes"):
            create_router(authenticate=_authenticate, max_body_bytes=bad)  # type: ignore[arg-type]


# --- configuration fails when it is built ---------------------------------


@pytest.mark.parametrize(
    "build",
    [
        lambda: HttpSecurity(allowed_hosts=()),
        lambda: HttpSecurity(allowed_hosts=("*",)),
        lambda: HttpSecurity(allowed_hosts=["api.test"]),  # type: ignore[arg-type]
        lambda: HttpSecurity(allowed_hosts=("API.test",)),
        lambda: HttpSecurity(allowed_hosts=("api.test:443",)),
        lambda: HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=("not-an-ip",)),
        lambda: HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=["10.0.0.1"]),  # type: ignore[arg-type]
        lambda: HttpSecurity(allowed_hosts=("api.test",), cors="*"),  # type: ignore[arg-type]
        lambda: CorsPolicy(origins=("*",), allow_credentials=True),
        lambda: CorsPolicy(origins=()),
        lambda: CorsPolicy(origins=("https://app.test/",)),
        lambda: CorsPolicy(origins=("https://app.test/path",)),
        lambda: CorsPolicy(origins=("https://App.test",)),
        lambda: CorsPolicy(origins=("null",)),
        lambda: CorsPolicy(origins=("app.test",)),
        lambda: CorsPolicy(origins=("https://*.app.test",)),
        lambda: CorsPolicy(origins=("https://app.test",), allow_methods=("*",)),
        lambda: CorsPolicy(origins=("https://app.test",), allow_headers=("*",)),
        lambda: CorsPolicy(origins=("https://app.test",), max_age=86_401),
    ],
)
def test_an_unsafe_configuration_fails_at_construction(build: Callable[[], object]) -> None:
    with pytest.raises((ValueError, TypeError)):
        build()


def test_install_requires_a_profile() -> None:
    with pytest.raises(TypeError):
        install_http_security(FastAPI(), {"allowed_hosts": ("api.test",)})  # type: ignore[arg-type]


# --- trusted hosts --------------------------------------------------------


def test_a_request_for_another_host_is_refused() -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test", "*.api.test")))

    assert _asgi(app, [("Host", "evil.test")]).status_code == 400
    assert _asgi(app, [("Host", "api.test.evil.test")]).status_code == 400
    assert _asgi(app, [("Host", "api.test")]).status_code == 200
    assert _asgi(app, [("Host", "eu.api.test")]).status_code == 200


@pytest.mark.parametrize("host", [b"api.test:443evil.test", b"api.test:99999", b"api.test:bad"])
def test_a_malformed_host_is_refused_before_starlette_parses_it(host: bytes) -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test",)))

    assert _asgi(app, [("Host", host.decode("ascii"))]).status_code == 400


def test_a_refused_host_is_not_redirected() -> None:
    app = _app(HttpSecurity(allowed_hosts=("www.api.test",)))

    response = _asgi(app, [("Host", "api.test")])
    assert response.status_code == 400
    assert "location" not in response.headers


# --- CORS -----------------------------------------------------------------


def test_cors_is_off_unless_configured() -> None:
    client = TestClient(_app(SECURE))

    response = client.get("/ids", headers={"Origin": "https://app.test"})
    preflight = client.options(
        "/echo",
        headers={"Origin": "https://app.test", "Access-Control-Request-Method": "POST"},
    )
    for result in (response, preflight):
        assert not any(name.startswith("access-control-") for name in result.headers)


def test_cors_answers_only_listed_origins() -> None:
    policy = CorsPolicy(origins=("https://app.test",), allow_credentials=True)
    client = TestClient(_app(HttpSecurity(allowed_hosts=("testserver",), cors=policy)))

    allowed = client.get("/ids", headers={"Origin": "https://app.test"})
    assert allowed.headers["access-control-allow-origin"] == "https://app.test"
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "Origin" in allowed.headers["vary"]
    assert "x-request-id" in allowed.headers["access-control-expose-headers"]

    for origin in ("https://evil.test", "https://app.test.evil.test", "null", "http://app.test"):
        refused = client.get("/ids", headers={"Origin": origin})
        assert "access-control-allow-origin" not in refused.headers

    preflight = client.options(
        "/echo",
        headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "POST"},
    )
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers


# --- request identifiers --------------------------------------------------


def test_every_response_carries_a_fresh_server_request_id() -> None:
    client = TestClient(_app(SECURE))

    responses = [
        client.get("/ids", headers=AUTH),
        client.get("/cacheable"),
        client.get("/missing"),
        client.post("/echo", json={}, headers=AUTH),
    ]
    ids = [response.headers["x-request-id"] for response in responses]
    assert all(REQUEST_ID.fullmatch(value) for value in ids)
    assert len(set(ids)) == len(ids)
    assert responses[1].status_code == 401
    assert responses[0].json()["request_id"] == ids[0]


def test_a_refused_host_still_gets_a_request_id() -> None:
    response = _asgi(_app(SECURE), [("Host", "evil.test")])

    assert response.status_code == 400
    assert REQUEST_ID.fullmatch(response.headers["x-request-id"])


def test_a_caller_request_id_is_only_ever_a_correlation_id() -> None:
    client = TestClient(_app(SECURE))

    response = client.get("/ids", headers={"X-Request-ID": "trace-123:abc/def"})

    assert response.headers["x-request-id"] != "trace-123:abc/def"
    assert REQUEST_ID.fullmatch(response.headers["x-request-id"])
    assert response.headers["x-correlation-id"] == "trace-123:abc/def"
    assert response.json()["request_id"] == response.headers["x-request-id"]


@pytest.mark.parametrize(
    "hostile",
    [
        "abc\r\nSet-Cookie: session=stolen",
        "abc\nforged log line",
        "abc\x00def",
        "abc\x1b[31mred",
        "\u0430bc",  # a Cyrillic letter that looks like "a"
        "abc def",
        ".leading-dot",
        "a" * (MAX_CORRELATION_ID_BYTES + 1),
        "",
        "{jndi:ldap://x}",
    ],
)
def test_a_hostile_request_id_is_dropped(hostile: str) -> None:
    assert sanitize_correlation_id(hostile) is None

    _, headers = _raw(
        _app(SECURE), "/ids", [(b"x-request-id", hostile.encode("utf-8"))], method="GET"
    )
    assert b"x-correlation-id" not in headers
    assert REQUEST_ID.fullmatch(headers[b"x-request-id"].decode())
    assert b"set-cookie" not in headers


def test_a_repeated_request_id_is_dropped() -> None:
    response = _asgi(
        _app(SECURE), [("Host", "api.test"), ("X-Request-ID", "one"), ("X-Request-ID", "two")]
    )
    assert "x-correlation-id" not in response.headers


def test_a_handler_cannot_replace_the_request_ids() -> None:
    response = TestClient(_app(SECURE)).get("/ids")

    assert response.headers.get_list("x-request-id") == [response.json()["request_id"]]
    assert "x-correlation-id" not in response.headers


def test_request_id_is_none_without_the_profile() -> None:
    response = TestClient(_app()).get("/ids")

    assert response.json()["request_id"] is None


# --- proxy trust ----------------------------------------------------------


def test_forwarded_headers_from_an_untrusted_client_are_ignored() -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=("10.0.0.0/8",)))

    response = _asgi(
        app,
        [("Host", "api.test"), ("X-Forwarded-For", "198.51.100.1"), ("X-Forwarded-Proto", "https")],
        client=("203.0.113.9", 5000),
    )
    assert response.json()["client"] == "203.0.113.9"
    assert response.json()["scheme"] == "http"


def test_a_trusted_proxy_supplies_the_nearest_untrusted_address() -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=("10.0.0.0/8",)))

    response = _asgi(
        app,
        [
            ("Host", "api.test"),
            # The leftmost entry was written by the client and proves nothing.
            ("X-Forwarded-For", "1.1.1.1, 198.51.100.7"),
            ("X-Forwarded-For", "10.0.0.2"),
            ("X-Forwarded-Proto", "https"),
        ],
        client=("10.0.0.3", 5000),
    )
    assert response.json()["client"] == "198.51.100.7"
    assert response.json()["scheme"] == "https"


def test_proxy_trust_is_off_by_default() -> None:
    response = _asgi(
        _app(SECURE),
        [("Host", "api.test"), ("X-Forwarded-For", "198.51.100.1")],
        client=("10.0.0.3", 5000),
    )
    assert response.json()["client"] == "10.0.0.3"


@pytest.mark.parametrize("proto", ["javascript", "HTTPS, http", "ftp"])
def test_a_trusted_proxy_cannot_set_an_unknown_scheme(proto: str) -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=("10.0.0.3",)))

    response = _asgi(
        app, [("Host", "api.test"), ("X-Forwarded-Proto", proto)], client=("10.0.0.3", 5000)
    )
    assert response.json()["scheme"] == "http"


@pytest.mark.parametrize("forwarded", ["unknown", "_hidden", "[2001:db8::1]:443", "1.2.3.4:80"])
def test_a_forwarded_non_address_leaves_the_client_unchanged(forwarded: str) -> None:
    app = _app(HttpSecurity(allowed_hosts=("api.test",), trusted_proxies=("10.0.0.3",)))

    response = _asgi(
        app, [("Host", "api.test"), ("X-Forwarded-For", forwarded)], client=("10.0.0.3", 5000)
    )
    assert response.json()["client"] == "10.0.0.3"
