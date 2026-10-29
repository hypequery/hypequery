"""`from_context`: the host's own session, and the core's same-origin check.

Decision 0023 §3 and §5. The check runs in the core, so every transport gets
it: the matrix runs on `Api.handle` and through the ASGI, WSGI, Django and
Flask adapters. Django's CSRF middleware is left out here (``csrf=False``) so
the core's answer is what is seen; `test_contrib_django_auth.py` covers the
two together.

These are not shared ``specs/serve-http`` fixtures: TypeScript's `fromContext`
leaves CSRF to the host framework and has no same-origin check to run them
against (decision 0023 §5).
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

import pytest
from pydantic import TypeAdapter

from core_transport import CoreClient
from hypequery.serve import (
    Api,
    Call,
    ContextStrategy,
    CorsPolicy,
    HttpSecurity,
    InvalidCredential,
    Principal,
    ProductionProfile,
    ServeRequest,
    ServeResponse,
    api_key,
    create_api,
    from_context,
    openapi_document,
)
from hypequery.serve.core import Headers
from hypequery.serve.core.utils.same_origin import same_origin_allowed, trusted_origins
from serve_transports import TRANSPORTS, serve_client

TRUSTED = "https://app.example"
SECURITY = HttpSecurity(
    allowed_hosts=("testserver",),
    cors=CorsPolicy(origins=(TRUSTED,), allow_credentials=True),
)
READER = Principal(subject="reader")
#: The transports whose request has a thread of its own.
SYNC = {"wsgi", "django-wsgi", "flask"}


class Session:
    """A stand-in for the host's session: who is signed in, and where it was read."""

    def __init__(self, principal: Principal | None = READER) -> None:
        self.principal = principal
        self.calls = 0
        self.threads: list[int] = []

    def __call__(self, request: ServeRequest) -> Principal | None:
        self.calls += 1
        self.threads.append(threading.get_ident())
        return self.principal


def _api(extract: Any, *, same_origin: bool = True, security: HttpSecurity = SECURITY) -> Api:
    async def whoami(call: Call) -> ServeResponse:
        assert call.auth is not None
        return ServeResponse.json({"subject": call.auth.principal.subject, "input": call.input})

    api = create_api(
        auth=from_context(extract, same_origin=same_origin),
        security=security,
        development_docs=True,
    )
    api.add_route("GET", "/whoami", whoami)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        api.add_route(method, "/whoami", whoami, input=TypeAdapter(dict[str, object]))
    return api


#: (method, headers, accepted) for a signed-in session.
MATRIX: list[tuple[str, dict[str, str], bool]] = [
    ("GET", {}, True),
    ("GET", {"sec-fetch-site": "cross-site", "origin": "https://evil.example"}, True),
    ("POST", {}, False),
    ("POST", {"sec-fetch-site": "same-origin"}, True),
    ("POST", {"sec-fetch-site": "none"}, True),
    ("POST", {"sec-fetch-site": "same-site"}, False),
    ("POST", {"sec-fetch-site": "cross-site"}, False),
    ("POST", {"sec-fetch-site": "cross-site", "origin": TRUSTED}, True),
    ("POST", {"sec-fetch-site": "same-site", "origin": TRUSTED}, True),
    ("POST", {"origin": TRUSTED}, True),
    ("POST", {"origin": "https://evil.example"}, False),
    ("POST", {"sec-fetch-site": "cross-site", "origin": "https://evil.example"}, False),
    ("POST", {"origin": "null"}, False),
    ("POST", {"origin": TRUSTED + ":443"}, False),
    ("POST", {"sec-fetch-site": "Same-Origin"}, False),
    # The request's own origin (http://testserver on every transport), for a
    # browser without Fetch Metadata.
    ("POST", {"origin": "http://testserver"}, True),
    ("POST", {"origin": "http://testserver:80"}, True),
    ("POST", {"origin": "https://testserver"}, False),
    ("POST", {"origin": "http://testserver:8000"}, False),
    ("POST", {"origin": "http://testserver.evil.example"}, False),
    ("POST", {"origin": "testserver"}, False),
    ("PUT", {}, False),
    ("PUT", {"sec-fetch-site": "same-origin"}, True),
    ("PATCH", {}, False),
    ("PATCH", {"origin": TRUSTED}, True),
    ("DELETE", {}, False),
    ("DELETE", {"sec-fetch-site": "same-origin"}, True),
]


@pytest.mark.parametrize("transport", TRANSPORTS)
@pytest.mark.parametrize(("method", "headers", "accepted"), MATRIX)
def test_same_origin_check_per_method_and_header(
    transport: str, method: str, headers: dict[str, str], accepted: bool
) -> None:
    session = Session()
    client = serve_client(transport, _api(session), csrf=False)
    body = None if method == "GET" else {"x": 1}
    response = client.request(method, "/whoami", headers=headers, json=body)
    if accepted:
        assert response.status_code == 200
        assert response.json() == {"subject": "reader", "input": body}
        assert response.headers["cache-control"] == "no-store"
        assert session.calls == 1
    else:
        assert response.status_code == 403
        assert response.json() == {
            "error": {
                "type": "FORBIDDEN",
                "message": "Cross-origin request refused.",
                "details": {"reason": "cross_origin"},
            }
        }
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-request-id"]
        # Refused before the host's session is read.
        assert session.calls == 0


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_same_origin_false_leaves_unsafe_methods_to_the_host(transport: str) -> None:
    session = Session()
    client = serve_client(transport, _api(session, same_origin=False), csrf=False)
    response = client.post("/whoami", headers={"sec-fetch-site": "cross-site"}, json={"x": 1})
    assert response.status_code == 200
    assert response.json()["subject"] == "reader"


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_no_session_is_unauthorized_without_a_challenge(transport: str) -> None:
    client = serve_client(transport, _api(Session(None)), csrf=False)
    response = client.get("/whoami")
    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "type": "UNAUTHORIZED",
            "message": "Access denied",
            "details": {"reason": "missing_credentials"},
        }
    }
    assert "www-authenticate" not in response.headers


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_a_sync_extractor_runs_on_the_request_thread_under_a_sync_host(transport: str) -> None:
    session = Session()
    client = serve_client(transport, _api(session), csrf=False)
    assert client.get("/whoami").status_code == 200
    # The sync test clients call the application on the test's own thread.
    on_request_thread = session.threads == [threading.get_ident()]
    assert on_request_thread is (transport in SYNC)


def test_an_async_extractor_runs_on_the_loop() -> None:
    loops: list[asyncio.AbstractEventLoop] = []

    async def extract(request: ServeRequest) -> Principal:
        loops.append(asyncio.get_running_loop())
        return Principal(subject="reader")

    assert CoreClient(_api(extract)).get("/whoami").status_code == 200
    assert len(loops) == 1


def test_extractor_failures_answer_in_the_envelope() -> None:
    def rejects(request: ServeRequest) -> Principal:
        raise InvalidCredential

    def breaks(request: ServeRequest) -> Principal:
        raise RuntimeError("session store at 10.0.0.5 is down")

    def wrong(request: ServeRequest) -> object:
        return {"subject": "reader"}

    rejected = CoreClient(_api(rejects)).get("/whoami")
    assert rejected.status_code == 401
    assert rejected.json()["error"]["details"] == {"reason": "invalid_credentials"}
    broken = CoreClient(_api(breaks)).get("/whoami")
    assert broken.status_code == 503
    assert broken.json()["error"]["type"] == "SERVICE_UNAVAILABLE"
    assert b"10.0.0.5" not in broken.content
    assert CoreClient(_api(wrong)).get("/whoami").status_code == 500


def test_the_extractor_reads_the_raw_request_and_the_tenant_comes_from_the_principal() -> None:
    seen: list[object] = []

    def extract(request: ServeRequest) -> Principal:
        seen.append(request.raw)
        return Principal(subject="reader", tenant_id="acme")

    async def tenant(call: Call) -> ServeResponse:
        assert call.auth is not None
        assert call.auth.tenant is not None
        return ServeResponse.json({"tenant": list(call.auth.tenant.ids)})

    api = create_api(auth=from_context(extract), security=SECURITY)
    api.add_route("GET", "/tenant", tenant)
    raw = object()
    request = ServeRequest(
        method="GET", path="/tenant", headers=Headers([("host", "testserver")]), raw=raw
    )
    response = asyncio.run(api.handle(request))
    assert response.status == 200
    assert seen == [raw]
    assert response.body == b'{"tenant":["acme"]}'


def test_public_routes_skip_the_session_and_its_check() -> None:
    session = Session()
    api = _api(session)

    async def ping(call: Call) -> ServeResponse:
        return ServeResponse.json({"auth": call.auth is not None})

    api.add_route("POST", "/ping", ping, public=True)
    response = CoreClient(api).post("/ping")
    assert response.status_code == 200
    assert response.json() == {"auth": False}
    assert session.calls == 0


def test_without_cors_only_fetch_metadata_is_trusted() -> None:
    api = _api(Session(), security=HttpSecurity(allowed_hosts=("testserver",)))
    client = CoreClient(api)
    assert client.post("/whoami", headers={"origin": TRUSTED}, json={}).status_code == 403
    assert (
        client.post("/whoami", headers={"sec-fetch-site": "same-origin"}, json={}).status_code
        == 200
    )


def test_a_wildcard_cors_policy_trusts_no_origin() -> None:
    security = HttpSecurity(allowed_hosts=("testserver",), cors=CorsPolicy(origins=("*",)))
    client = CoreClient(_api(Session(), security=security))
    response = client.post("/whoami", headers={"origin": "https://evil.example"}, json={})
    assert response.status_code == 403


def test_a_repeated_header_is_not_believed() -> None:
    trusted = trusted_origins((TRUSTED,))
    repeated_site = Headers([("sec-fetch-site", "same-origin"), ("sec-fetch-site", "none")])
    repeated_origin = Headers([("origin", TRUSTED), ("origin", TRUSTED)])
    repeated_host = Headers(
        [("origin", "http://a.example"), ("host", "a.example"), ("host", "b.example")]
    )
    assert not same_origin_allowed("POST", repeated_site, trusted, "http")
    assert not same_origin_allowed("POST", repeated_origin, trusted, "http")
    assert not same_origin_allowed("POST", repeated_host, trusted, "http")
    assert same_origin_allowed("HEAD", Headers(), trusted, "http")
    assert same_origin_allowed("OPTIONS", Headers(), trusted, "http")
    assert trusted_origins(("*",)) == frozenset()


@pytest.mark.parametrize(
    ("origin", "host", "scheme", "accepted"),
    [
        ("https://app.example", "app.example", "https", True),
        ("https://app.example", "app.example:443", "https", True),
        ("https://app.example:8443", "app.example:8443", "https", True),
        ("https://app.example", "app.example", "http", False),
        ("http://[::1]:8000", "[0:0::1]:8000", "http", True),
        ("http://APP.example", "app.example.", "http", True),
        ("http://app.example", "app.example:99999", "http", False),
        ("ftp://app.example", "app.example", "ftp", False),
    ],
)
def test_the_own_origin_is_the_scheme_and_host(
    origin: str, host: str, scheme: str, accepted: bool
) -> None:
    headers = Headers([("origin", origin), ("host", host)])
    assert same_origin_allowed("POST", headers, frozenset(), scheme) is accepted


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_every_adapter_passes_its_scheme_to_the_own_origin_check(transport: str) -> None:
    client = serve_client(transport, _api(Session()), csrf=False, scheme="https")
    own = client.post("/whoami", headers={"origin": "https://testserver"}, json={})
    assert own.status_code == 200
    downgraded = client.post("/whoami", headers={"origin": "http://testserver"}, json={})
    assert downgraded.status_code == 403


@pytest.mark.parametrize("transport", [name for name in TRANSPORTS if name.startswith("django")])
def test_django_secure_proxy_ssl_header_sets_the_scheme(transport: str) -> None:
    from serve_transports import PEER, DjangoClient

    client = DjangoClient(
        _api(Session()),
        asgi=transport == "django-asgi",
        client=PEER,
        prefix="",
        raw_uri=True,
        csrf=False,
        settings={"SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https")},
    )
    headers = {"origin": "https://testserver", "x-forwarded-proto": "https"}
    assert client.post("/whoami", headers=headers, json={}).status_code == 200
    # Without the setting Django ignores the header, and the scheme stays http.
    plain = serve_client(transport, _api(Session()), csrf=False)
    assert plain.post("/whoami", headers=headers, json={}).status_code == 403


@pytest.mark.skipif("flask" not in TRANSPORTS, reason="flask is not installed")
def test_flask_proxy_fix_sets_the_scheme() -> None:
    from werkzeug.middleware.proxy_fix import ProxyFix

    from serve_transports import flask_app
    from wsgi_client import WsgiClient

    app = flask_app(_api(Session()))
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)  # type: ignore[method-assign]
    headers = {"origin": "https://testserver", "x-forwarded-proto": "https"}
    assert WsgiClient(app).post("/whoami", headers=headers, json={}).status_code == 200
    plain = WsgiClient(flask_app(_api(Session())))
    assert plain.post("/whoami", headers=headers, json={}).status_code == 403


def test_a_trusted_proxy_supplies_the_own_origins_scheme() -> None:
    security = HttpSecurity(allowed_hosts=("app.example",), trusted_proxies=("10.0.0.0/8",))
    behind = {"host": "app.example", "origin": "https://app.example", "x-forwarded-proto": "https"}
    proxied = CoreClient(_api(Session(), security=security), client=("10.0.0.5", 40000))
    assert proxied.post("/whoami", headers=behind, json={}).status_code == 200
    # From a peer that is not a trusted proxy, the forwarded scheme is ignored.
    direct = CoreClient(_api(Session(), security=security), client=("203.0.113.9", 40000))
    assert direct.post("/whoami", headers=behind, json={}).status_code == 403


def test_from_context_and_create_api_validate_their_arguments() -> None:
    with pytest.raises(TypeError, match="extract"):
        from_context("not callable")  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="same_origin"):
        from_context(Session(), same_origin="yes")  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="session_cookie"):
        ContextStrategy(Session(), session_cookie="")
    with pytest.raises(TypeError, match="credentials"):
        create_api(auth=from_context(Session()), credentials=api_key())
    with pytest.raises(TypeError, match="from_context"):
        create_api(auth="not callable")  # type: ignore[arg-type]
    strategy = from_context(Session())
    assert strategy.same_origin is True
    assert type(strategy) is ContextStrategy


def test_openapi_and_discovery_describe_a_session() -> None:
    api = _api(Session())
    document: Any = openapi_document(api)
    assert document["components"]["securitySchemes"]["credential"] == {
        "type": "apiKey",
        "in": "cookie",
        "name": "session",
        "description": "The host application's own session.",
    }
    assert api.authentication.vary == "cookie"
    assert api.authentication.credentials is None


def test_a_request_thread_extractor_holds_its_production_slot_until_it_returns() -> None:
    """A sync host's session lookup past the deadline: 504, and the slot stays taken."""

    started = threading.Event()
    release = threading.Event()

    def extract(request: ServeRequest) -> Principal:
        if not release.is_set():
            started.set()
            release.wait(10)
        return READER

    api = create_api(
        auth=from_context(extract),
        security=SECURITY,
        production=ProductionProfile(max_concurrency=1, timeout_seconds=1),
    )

    async def whoami(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    api.add_route("GET", "/whoami", whoami)
    gate: Any = api._gate
    client = serve_client("wsgi", api)
    answers: list[int] = []
    first = threading.Thread(target=lambda: answers.append(client.get("/whoami").status_code))
    first.start()
    try:
        assert started.wait(5)
        time.sleep(1.5)  # past the deadline: the core has answered 504
        assert gate.active == 1
        # The lookup still runs on the first request's thread: no second slot.
        assert serve_client("wsgi", api).get("/whoami").status_code == 503
    finally:
        release.set()
        first.join(10)
    assert answers == [504]
    deadline = time.monotonic() + 5
    while gate.active and time.monotonic() < deadline:
        time.sleep(0.01)
    assert gate.active == 0
    assert serve_client("wsgi", api).get("/whoami").status_code == 200


def test_request_thread_work_queued_past_cancellation_is_skipped_and_finishes() -> None:
    """A tracked callback that starts after its request was cancelled must not hang."""

    from hypequery.serve.core.work import RequestWork
    from hypequery.serve.utils.serving_loop import RequestThread, serving_loop

    busy = threading.Event()
    release = threading.Event()
    called: list[bool] = []

    async def scenario(thread: RequestThread) -> bool:
        work = RequestWork()

        def block() -> None:
            busy.set()
            release.wait(5)

        # The request's thread is busy, so the tracked callback waits in its queue.
        blocker = asyncio.ensure_future(thread.call(block))
        await asyncio.to_thread(busy.wait, 5)
        task = work.start_on_thread(thread.call, lambda: called.append(True))
        work.cancel()
        release.set()
        await blocker
        await asyncio.wait_for(work.drain(), 5)
        return task.cancelled()

    assert serving_loop().run(scenario) is True
    assert called == []
