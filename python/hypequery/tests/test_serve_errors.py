"""PYD-04: canonical errors and rate limiting, beyond the shared fixtures.

The fixtures in specs/serve-http pin what TypeScript and Python share. These
pin the Python-specific parts: how RFC 0010 categories and endpoint
exceptions map onto the envelope, that routing errors are converted without
taking over the application's own handlers, and the rate limiter's keying,
ordering, and bounds.
"""

# No `from __future__ import annotations`: FastAPI resolves endpoint
# annotations at registration, and these endpoints close over local routers.
import logging
import time
from typing import Annotated, Any

import pytest
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from hypequery.datasets import CompiledQueryError
from hypequery.serve import (
    Credential,
    HttpSecurity,
    MemoryRateLimitStore,
    Principal,
    RateLimit,
    RequestAuth,
    ServeError,
    ServeRouter,
    create_router,
    install_http_security,
    request_id,
)
from hypequery.serve.rate_limit import RateLimitCapacityError

TOKENS = {"alice-token": "alice", "bob-token": "bob"}


def _authenticate(credential: Credential) -> Principal | None:
    subject = TOKENS.get(credential.value)
    return Principal(subject=subject) if subject else None


def _auth(token: str = "alice-token") -> dict[str, str]:  # noqa: S107 - a test credential
    return {"Authorization": f"Bearer {token}"}


def _client(router: ServeRouter, *, security: HttpSecurity | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    install_http_security(app, security or HttpSecurity(allowed_hosts=("testserver",)))
    return TestClient(app, raise_server_exceptions=False)


# --- mapping onto the envelope ---------------------------------------------


@pytest.mark.parametrize(
    ("category", "status", "kind"),
    [
        ("input-invalid", 400, "VALIDATION_ERROR"),
        ("unauthenticated", 401, "UNAUTHORIZED"),
        ("forbidden", 403, "FORBIDDEN"),
        ("tenant-required", 403, "FORBIDDEN"),
        ("not-found", 404, "NOT_FOUND"),
        ("too-large", 413, "PAYLOAD_TOO_LARGE"),
        ("aborted", 503, "SERVICE_UNAVAILABLE"),
        ("deadline-exceeded", 504, "GATEWAY_TIMEOUT"),
        ("unavailable", 503, "CLICKHOUSE_UNREACHABLE"),
        ("internal", 500, "INTERNAL_SERVER_ERROR"),
    ],
)
def test_a_query_error_maps_to_its_canonical_status(category: Any, status: int, kind: str) -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/query")
    def query() -> None:
        raise CompiledQueryError(category, "Dataset field 'x' is not queryable.")

    response = _client(router).get("/query", headers=_auth())

    assert response.status_code == status
    assert response.json()["error"]["type"] == kind
    assert response.headers["cache-control"] == "no-store"
    if status >= 500:
        assert "queryable" not in response.text
    else:
        assert response.json()["error"]["message"] == "Dataset field 'x' is not queryable."


def test_an_endpoint_http_error_keeps_only_a_string_message() -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/teapot")
    def teapot() -> None:
        raise HTTPException(403, detail="Reports are disabled for this account.")

    @router.get("/structured")
    def structured() -> None:
        raise HTTPException(409, detail={"sql": "SELECT secret", "row": 7})

    @router.get("/bad-gateway")
    def bad_gateway() -> None:
        raise HTTPException(502, detail="upstream 10.0.0.7 refused")

    client = _client(router)

    forbidden = client.get("/teapot", headers=_auth())
    assert (forbidden.status_code, forbidden.json()["error"]) == (
        403,
        {"type": "FORBIDDEN", "message": "Reports are disabled for this account."},
    )
    conflict = client.get("/structured", headers=_auth())
    assert conflict.status_code == 409
    assert conflict.json()["error"]["type"] == "VALIDATION_ERROR"
    assert "SELECT" not in conflict.text
    gateway = client.get("/bad-gateway", headers=_auth())
    assert gateway.json()["error"] == {
        "type": "INTERNAL_SERVER_ERROR",
        "message": "An unexpected error occurred",
    }


def test_a_serve_error_is_sent_as_written() -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/custom")
    def custom() -> None:
        raise ServeError(
            429,
            "RATE_LIMITED",
            "Slow down",
            details={"reason": "quota"},
            headers={"Retry-After": "5"},
        )

    response = _client(router).get("/custom", headers=_auth())

    assert response.status_code == 429
    assert response.json() == {
        "error": {"type": "RATE_LIMITED", "message": "Slow down", "details": {"reason": "quota"}}
    }
    assert response.headers["retry-after"] == "5"


@pytest.mark.parametrize("security", [False, True])
def test_error_headers_override_supplied_values_without_case_duplicates(security: bool) -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/headers")
    @router.public
    def endpoint() -> None:
        raise ServeError(
            429,
            "RATE_LIMITED",
            "Slow down",
            headers={
                "cache-control": "public, max-age=60",
                "Cache-Control": "public, max-age=120",
                "X-Request-ID": "caller-supplied",
                "Retry-After": "5",
            },
        )

    app = FastAPI()
    app.include_router(router)
    if security:
        install_http_security(app, HttpSecurity(allowed_hosts=("testserver",)))
    response = TestClient(app).get("/headers")

    assert response.status_code == 429
    assert response.headers.get_list("cache-control") == ["no-store"]
    assert len(response.headers.get_list("x-request-id")) == 1
    assert "caller-supplied" not in response.headers["x-request-id"]
    assert response.headers["retry-after"] == "5"


@pytest.mark.parametrize("security", [False, True])
def test_an_unexpected_error_is_logged_with_its_request_id_and_not_sent(
    caplog: pytest.LogCaptureFixture,
    security: bool,
) -> None:
    router = create_router(authenticate=_authenticate)
    seen: list[str | None] = []

    @router.get("/boom")
    def boom(request: Request) -> None:
        seen.append(request_id(request))
        raise RuntimeError("password=hunter2 at /srv/app.py")

    app = FastAPI()
    app.include_router(router)
    if security:
        install_http_security(app, HttpSecurity(allowed_hosts=("testserver",)))
    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        response = TestClient(app, raise_server_exceptions=False).get("/boom", headers=_auth())

    assert response.status_code == 500
    assert "hunter2" not in response.text
    if security:
        assert response.headers["x-request-id"] == seen[0]
    [record] = [r for r in caplog.records if r.name == "hypequery.serve"]
    assert record.exc_info is not None
    assert "hunter2" in str(record.exc_info[1])
    assert response.headers["x-request-id"] in record.getMessage()


def test_validation_issues_never_echo_the_submitted_value() -> None:
    router = create_router(authenticate=_authenticate)

    @router.post("/limit")
    def limit(value: Annotated[int, Body(embed=True)]) -> dict[str, int]:
        return {"value": value}

    response = _client(router).post("/limit", json={"value": "SECRET-INPUT"}, headers=_auth())

    assert response.status_code == 400
    assert response.json()["error"]["details"]["issues"][0]["path"] == ["value"]
    assert "SECRET-INPUT" not in response.text


# --- routing errors ---------------------------------------------------------


def test_a_wrong_method_is_a_404_without_listing_methods() -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/only-get")
    def only_get() -> dict[str, bool]:
        return {"ok": True}

    response = _client(router).post("/only-get")

    assert response.status_code == 404
    assert response.json()["error"] == {
        "type": "NOT_FOUND",
        "message": "No endpoint registered for POST /only-get",
    }
    assert "allow" not in response.headers


def test_a_hostile_path_is_not_echoed() -> None:
    response = _client(create_router(authenticate=_authenticate)).get("/caf%C3%A9/%0d%0aX:1")

    assert response.status_code == 404
    assert response.json()["error"]["message"] in (
        "No endpoint registered for GET /caf%C3%A9/%0d%0aX:1",
        "No endpoint registered for this request",
    )
    assert "\r" not in response.text


def test_the_applications_own_http_errors_keep_their_handler() -> None:
    app = FastAPI()

    @app.exception_handler(StarletteHTTPException)
    async def own(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"own": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.get("/thing")
    def thing() -> None:
        raise HTTPException(404, detail="no such thing")

    @app.get("/method")
    def method() -> None:
        raise HTTPException(405, detail="chosen status", headers={"Allow": "PATCH"})

    install_http_security(app, HttpSecurity(allowed_hosts=("testserver",)))
    client = TestClient(app)

    assert client.get("/thing").json() == {"own": "no such thing"}
    assert client.get("/nowhere").json()["error"]["type"] == "NOT_FOUND"
    wrong_method = client.post("/thing")
    assert wrong_method.status_code == 405
    assert wrong_method.json() == {"own": "Method Not Allowed"}
    deliberate = client.get("/method")
    assert deliberate.status_code == 405
    assert deliberate.json() == {"own": "chosen status"}
    assert deliberate.headers["allow"] == "PATCH"


# --- rate limiting ----------------------------------------------------------


def _limited(limit: RateLimit, calls: list[str]) -> ServeRouter:
    router = create_router(authenticate=_authenticate)

    @router.post("/limited", dependencies=[Depends(limit)])
    def limited(payload: Annotated[dict[str, Any], Body()]) -> dict[str, bool]:
        calls.append("ran")
        return {"ok": True}

    return router


def test_a_limit_counts_each_request_once() -> None:
    calls: list[str] = []
    client = _client(_limited(RateLimit(max=2, window_seconds=60), calls))

    statuses = [client.post("/limited", json={}, headers=_auth()).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert calls == ["ran", "ran"]


def test_a_limited_request_reads_no_body_and_runs_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    client = _client(_limited(RateLimit(max=1, window_seconds=60), calls))
    assert client.post("/limited", json={}, headers=_auth()).status_code == 200

    reads: list[str] = []
    original = Request.body

    async def spy(self: Request) -> bytes:
        reads.append("body")
        return await original(self)

    monkeypatch.setattr(Request, "body", spy)
    response = client.post(
        "/limited",
        content=b'{"a": "' + b"x" * 500_000 + b'"}',
        headers={**_auth(), "Content-Type": "application/json"},
    )

    assert response.status_code == 429
    assert reads == []
    assert calls == ["ran"]


def test_endpoint_parameter_limit_rejects_before_body_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    router = create_router(authenticate=_authenticate)
    limit = RateLimit(max=1, window_seconds=60)

    @router.post("/parameter")
    def endpoint(
        payload: Annotated[dict[str, Any], Body()],
        limited: Annotated[None, Depends(limit)],
    ) -> dict[str, bool]:
        return {"ok": True}

    client = _client(router)
    assert client.post("/parameter", json={}, headers=_auth()).status_code == 200
    reads: list[str] = []
    original = Request.body

    async def spy(self: Request) -> bytes:
        reads.append("body")
        return await original(self)

    monkeypatch.setattr(Request, "body", spy)
    response = client.post("/parameter", content=b"not JSON", headers=_auth())
    assert response.status_code == 429
    assert reads == []


def test_each_principal_has_its_own_window() -> None:
    client = _client(_limited(RateLimit(max=1, window_seconds=60), []))

    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 200
    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 429
    assert client.post("/limited", json={}, headers=_auth("bob-token")).status_code == 200


@pytest.mark.parametrize("placement", ["route", "parameter", "nested"])
def test_custom_limit_keys_run_after_the_dependencies_that_prepare_state(placement: str) -> None:
    router = create_router(authenticate=_authenticate)
    events: list[str] = []

    def account(request: Request) -> None:
        events.append("account")
        request.state.account = "account-a"

    def key(request: Request, auth: RequestAuth | None) -> str:
        events.append("key")
        assert auth is not None
        return str(request.state.account)

    limit = RateLimit(max=1, key=key)

    def nested(
        prepared: Annotated[None, Depends(account)],
        limited: Annotated[None, Depends(limit)],
    ) -> None:
        pass

    if placement == "route":

        @router.post("/custom", dependencies=[Depends(account), Depends(limit)])
        def route_endpoint(payload: Annotated[dict[str, Any], Body()]) -> dict[str, bool]:
            events.append("endpoint")
            return {"ok": True}

    elif placement == "parameter":

        @router.post("/custom")
        def parameter_endpoint(
            payload: Annotated[dict[str, Any], Body()],
            prepared: Annotated[None, Depends(account)],
            limited: Annotated[None, Depends(limit)],
        ) -> dict[str, bool]:
            events.append("endpoint")
            return {"ok": True}

    else:

        @router.post("/custom", dependencies=[Depends(nested)])
        def nested_endpoint(payload: Annotated[dict[str, Any], Body()]) -> dict[str, bool]:
            events.append("endpoint")
            return {"ok": True}

    client = _client(router)
    assert client.post("/custom", json={}, headers=_auth()).status_code == 200
    assert client.post("/custom", json={}, headers=_auth()).status_code == 429
    assert events == ["account", "key", "endpoint", "account", "key"]


@pytest.mark.parametrize("custom_key", [False, True])
def test_limits_run_in_dependency_order_without_consuming_later_quota_on_rejection(
    custom_key: bool,
) -> None:
    events: list[str] = []

    class Store:
        def __init__(self, name: str) -> None:
            self.name = name
            self.count = 0

        async def hit(self, key: str, window_seconds: int) -> tuple[int, float]:
            events.append(self.name)
            self.count += 1
            return self.count, 60.0

    first = RateLimit(
        max=1,
        store=Store("first"),
        key=(lambda request, auth: "account") if custom_key else None,
    )
    second = RateLimit(max=2, store=Store("second"))
    router = create_router(authenticate=_authenticate)

    @router.get("/ordered", dependencies=[Depends(first), Depends(second)])
    def endpoint() -> dict[str, bool]:
        return {"ok": True}

    client = _client(router)
    assert client.get("/ordered", headers=_auth()).status_code == 200
    assert client.get("/ordered", headers=_auth()).status_code == 429
    assert events == ["first", "second", "first"]


def test_tenants_with_the_same_subject_have_separate_windows() -> None:
    def authenticate(credential: Credential) -> Principal:
        return Principal(subject="same-subject", tenant_id=credential.value)

    router = create_router(authenticate=authenticate)

    @router.get("/limited", dependencies=[Depends(RateLimit(max=1, window_seconds=60))])
    def limited() -> dict[str, bool]:
        return {"ok": True}

    client = _client(router)
    assert client.get("/limited", headers=_auth("tenant-a")).status_code == 200
    assert client.get("/limited", headers=_auth("tenant-a")).status_code == 429
    assert client.get("/limited", headers=_auth("tenant-b")).status_code == 200


def test_a_spoofed_forwarded_address_does_not_open_a_new_window() -> None:
    router = create_router(authenticate=_authenticate)

    @router.get("/open", dependencies=[Depends(RateLimit(max=1, window_seconds=60))])
    @router.public
    def open_route() -> dict[str, bool]:
        return {"ok": True}

    client = _client(router)

    assert client.get("/open", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert client.get("/open", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429
    assert client.get("/open", headers={"X-Real-IP": "3.3.3.3"}).status_code == 429


def test_a_failing_store_lets_requests_through_by_default() -> None:
    class Failing:
        async def hit(self, key: str, window_seconds: int) -> tuple[int, float]:
            raise ConnectionError("redis down")

    client = _client(_limited(RateLimit(store=Failing()), []))

    assert client.post("/limited", json={}, headers=_auth()).status_code == 200


def test_a_window_resets(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [1_000.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    client = _client(_limited(RateLimit(max=1, window_seconds=10), []))

    assert client.post("/limited", json={}, headers=_auth()).status_code == 200
    limited = client.post("/limited", json={}, headers=_auth())
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "10"
    now[0] += 10
    assert client.post("/limited", json={}, headers=_auth()).status_code == 200


def test_the_memory_store_refuses_new_keys_without_resetting_active_counters() -> None:
    import asyncio

    store = MemoryRateLimitStore(max_keys=2)

    async def fill() -> None:
        for key in ("a", "b"):
            await store.hit(key, 60)
        with pytest.raises(RateLimitCapacityError):
            await store.hit("c", 60)
        assert (await store.hit("a", 60))[0] == 2

    asyncio.run(fill())
    assert len(store._windows) == 2


def test_the_memory_store_evicts_expired_windows_first(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    store = MemoryRateLimitStore(max_keys=3)

    async def scenario() -> None:
        await store.hit("long", 100)
        await store.hit("short", 1)
        await store.hit("long-2", 100)
        now[0] = 5.0
        await store.hit("new", 100)

    asyncio.run(scenario())
    assert set(store._windows) == {"long", "long-2", "new"}


def test_memory_store_capacity_fails_closed_even_with_fail_open_default() -> None:
    store = MemoryRateLimitStore(max_keys=1)
    limit = RateLimit(max=1, window_seconds=60, store=store)
    client = _client(_limited(limit, []))

    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 200
    response = client.post("/limited", json={}, headers=_auth("bob-token"))
    assert response.status_code == 503
    assert response.json()["error"]["type"] == "SERVICE_UNAVAILABLE"
    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 429


def test_rate_limit_validates_its_configuration() -> None:
    for kwargs in ({"max": 0}, {"window_seconds": 0}, {"max": 1.5}):
        with pytest.raises(ValueError, match="RateLimit"):
            RateLimit(**kwargs)
    with pytest.raises(TypeError):
        RateLimit(store=object())  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        RateLimit(key="client")  # type: ignore[arg-type]
