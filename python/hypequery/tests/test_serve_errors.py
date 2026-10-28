"""PYD-04: canonical errors and rate limiting, beyond the shared fixtures.

The fixtures in specs/serve-http pin what TypeScript and Python share. These
pin the Python-specific parts: how RFC 0010 categories and handler exceptions
map onto the envelope, routing errors, and the rate limiter's keying,
ordering, and bounds.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pydantic import BaseModel, StrictInt, TypeAdapter

from asgi_client import AsgiClient
from hypequery.datasets import CompiledQueryError
from hypequery.serve import (
    Api,
    Call,
    Credential,
    HttpSecurity,
    MemoryRateLimitStore,
    Principal,
    RateLimit,
    RequestAuth,
    ServeError,
    ServeRequest,
    ServeResponse,
    create_api,
    to_asgi_app,
)
from hypequery.serve.rate_limit import RateLimitCapacityError

TOKENS = {"alice-token": "alice", "bob-token": "bob"}
OBJECT: TypeAdapter[object] = TypeAdapter(dict[str, Any])


def _authenticate(credential: Credential) -> Principal | None:
    subject = TOKENS.get(credential.value)
    return Principal(subject=subject) if subject else None


def _auth(token: str = "alice-token") -> dict[str, str]:  # noqa: S107 - a test credential
    return {"Authorization": f"Bearer {token}"}


def _api(**options: Any) -> Api:
    return create_api(
        auth=options.pop("auth", _authenticate),
        security=options.pop("security", HttpSecurity(allowed_hosts=("testserver",))),
        **options,
    )


def _client(api: Api) -> AsgiClient:
    return AsgiClient(to_asgi_app(api), raise_server_exceptions=False)


async def _ok(call: Call) -> ServeResponse:
    return ServeResponse.json({"ok": True})


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
    async def query(call: Call) -> ServeResponse:
        raise CompiledQueryError(category, "Dataset field 'x' is not queryable.")

    api = _api()
    api.add_route("GET", "/query", query)
    response = _client(api).get("/query", headers=_auth())

    assert response.status_code == status
    assert response.json()["error"]["type"] == kind
    assert response.headers["cache-control"] == "no-store"
    if status >= 500:
        assert "queryable" not in response.text
    else:
        assert response.json()["error"]["message"] == "Dataset field 'x' is not queryable."


def _body_api() -> Api:
    async def echo(call: Call) -> ServeResponse:
        assert isinstance(call.input, dict)
        return ServeResponse.json({"keys": sorted(call.input)})

    api = _api()
    api.add_route("POST", "/echo", echo, input=OBJECT)
    return api


@pytest.mark.parametrize(
    ("content", "headers", "status"),
    [
        # Not valid UTF-8: a parse error, which is caller input.
        ('{"name": "caf\xe9"}'.encode("latin-1"), {}, {400}),
        # Nested past the recursion limit of Python 3.13 and earlier; 3.14's
        # decoder parses it, so either answer is fine as long as it is not 500.
        (b'{"a":' + b"[" * 100_000 + b"]" * 100_000 + b"}", {}, {200, 400}),
        (b"\x1f\x8b\x08\x00", {"content-encoding": "gzip"}, {415}),
        (b"{}", {"content-encoding": "br"}, {415}),
    ],
    ids=["latin-1", "deep-nesting", "gzip", "brotli"],
)
def test_an_unreadable_body_is_caller_input_not_a_server_error(
    content: bytes,
    headers: dict[str, str],
    status: set[int],
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = _client(_body_api())
    response = client.post(
        "/echo",
        content=content,
        headers={**_auth(), "content-type": "application/json", **headers},
    )
    assert response.status_code in status
    if response.status_code != 200:
        assert response.json()["error"]["type"] == "VALIDATION_ERROR"
    assert "Unhandled error" not in caplog.text


def test_an_identity_content_encoding_is_accepted() -> None:
    client = _client(_body_api())
    response = client.post(
        "/echo",
        content=b'{"b": 1, "a": 2}',
        headers={**_auth(), "content-type": "application/json", "content-encoding": "identity"},
    )
    assert response.json() == {"keys": ["a", "b"]}


def test_a_serve_error_is_sent_as_written() -> None:
    async def custom(call: Call) -> ServeResponse:
        raise ServeError(
            429,
            "RATE_LIMITED",
            "Slow down",
            details={"reason": "quota"},
            headers={"Retry-After": "5"},
        )

    api = _api()
    api.add_route("GET", "/custom", custom)
    response = _client(api).get("/custom", headers=_auth())

    assert response.status_code == 429
    assert response.json() == {
        "error": {"type": "RATE_LIMITED", "message": "Slow down", "details": {"reason": "quota"}}
    }
    assert response.headers["retry-after"] == "5"


@pytest.mark.parametrize("security", [False, True])
def test_error_headers_override_supplied_values_without_case_duplicates(security: bool) -> None:
    async def endpoint(call: Call) -> ServeResponse:
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

    api = _api(security=HttpSecurity(allowed_hosts=("testserver",)) if security else None)
    api.add_route("GET", "/headers", endpoint, public=True)
    response = _client(api).get("/headers")

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
    seen: list[str] = []

    async def boom(call: Call) -> ServeResponse:
        seen.append(call.state.request_id)
        raise RuntimeError("password=hunter2 at /srv/app.py")

    api = _api(security=HttpSecurity(allowed_hosts=("testserver",)) if security else None)
    api.add_route("GET", "/boom", boom)
    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        response = _client(api).get("/boom", headers=_auth())

    assert response.status_code == 500
    assert "hunter2" not in response.text
    assert response.headers["x-request-id"] == seen[0]
    [record] = [r for r in caplog.records if r.name == "hypequery.serve"]
    assert record.exc_info is not None
    assert "hunter2" in str(record.exc_info[1])
    assert response.headers["x-request-id"] in record.getMessage()


class _Limit(BaseModel):
    value: StrictInt


def test_validation_issues_never_echo_the_submitted_value() -> None:
    async def limit(call: Call) -> ServeResponse:
        return ServeResponse.json({})

    api = _api()
    api.add_route("POST", "/limit", limit, input=TypeAdapter(_Limit))
    response = _client(api).post("/limit", json={"value": "SECRET-INPUT"}, headers=_auth())

    assert response.status_code == 400
    assert response.json()["error"]["details"]["issues"][0]["path"] == ["value"]
    assert "SECRET-INPUT" not in response.text


# --- routing errors ---------------------------------------------------------


def test_a_wrong_method_is_a_404_without_listing_methods() -> None:
    api = _api()
    api.add_route("GET", "/only-get", _ok)
    response = _client(api).post("/only-get")

    assert response.status_code == 404
    assert response.json()["error"] == {
        "type": "NOT_FOUND",
        "message": "No endpoint registered for POST /only-get",
    }
    assert "allow" not in response.headers


def test_a_hostile_path_is_not_echoed() -> None:
    response = _client(_api()).get("/caf%C3%A9/%0d%0aX:1")

    assert response.status_code == 404
    assert response.json()["error"]["message"] in (
        "No endpoint registered for GET /caf%C3%A9/%0d%0aX:1",
        "No endpoint registered for this request",
    )
    assert "\r" not in response.text


# --- rate limiting ----------------------------------------------------------


def _limited(limit: RateLimit, calls: list[str]) -> Api:
    async def limited(call: Call) -> ServeResponse:
        calls.append("ran")
        return ServeResponse.json({"ok": True})

    api = _api()
    api.add_route("POST", "/limited", limited, input=OBJECT, limits=[limit])
    return api


def test_a_limit_counts_each_request_once() -> None:
    calls: list[str] = []
    client = _client(_limited(RateLimit(max=2, window_seconds=60), calls))

    statuses = [client.post("/limited", json={}, headers=_auth()).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert calls == ["ran", "ran"]


def test_a_limited_request_reads_no_body_and_runs_nothing() -> None:
    import asyncio

    from hypequery.serve import Headers

    calls: list[str] = []
    api = _limited(RateLimit(max=1, window_seconds=60), calls)
    reads: list[str] = []

    async def body(content: bytes) -> AsyncIterator[bytes]:
        reads.append("body")
        yield content

    def request(content: bytes) -> ServeRequest:
        headers = [
            ("host", "testserver"),
            ("authorization", "Bearer alice-token"),
            ("content-type", "application/json"),
        ]
        return ServeRequest(
            method="POST", path="/limited", headers=Headers(headers), body=body(content)
        )

    assert asyncio.run(api.handle(request(b"{}"))).status == 200
    assert reads == ["body"]
    response = asyncio.run(api.handle(request(b'{"a": "' + b"x" * 500_000 + b'"}')))

    assert response.status == 429
    assert reads == ["body"]
    assert calls == ["ran"]


def test_each_principal_has_its_own_window() -> None:
    client = _client(_limited(RateLimit(max=1, window_seconds=60), []))

    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 200
    assert client.post("/limited", json={}, headers=_auth("alice-token")).status_code == 429
    assert client.post("/limited", json={}, headers=_auth("bob-token")).status_code == 200


def test_a_custom_key_sees_the_request_and_the_authenticated_caller() -> None:
    seen: list[tuple[str, str | None]] = []

    def key(request: ServeRequest, auth: RequestAuth | None) -> str:
        assert auth is not None
        seen.append((request.path, request.headers.get("x-account")))
        return request.headers.get("x-account") or auth.principal.subject

    client = _client(_limited(RateLimit(max=1, key=key), []))
    account_a = {**_auth(), "x-account": "a"}
    assert client.post("/limited", json={}, headers=account_a).status_code == 200
    assert client.post("/limited", json={}, headers=account_a).status_code == 429
    assert (
        client.post("/limited", json={}, headers={**_auth(), "x-account": "b"}).status_code == 200
    )
    assert seen == [("/limited", "a"), ("/limited", "a"), ("/limited", "b")]


@pytest.mark.parametrize("custom_key", [False, True])
def test_limits_run_api_first_in_order_without_consuming_later_quota_on_rejection(
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
    api = _api(limits=[first])
    api.add_route("GET", "/ordered", _ok, limits=[second])

    client = _client(api)
    assert client.get("/ordered", headers=_auth()).status_code == 200
    assert client.get("/ordered", headers=_auth()).status_code == 429
    assert events == ["first", "second", "first"]


def test_tenants_with_the_same_subject_have_separate_windows() -> None:
    def authenticate(credential: Credential) -> Principal:
        return Principal(subject="same-subject", tenant_id=credential.value)

    api = _api(auth=authenticate)
    api.add_route("GET", "/limited", _ok, limits=[RateLimit(max=1, window_seconds=60)])

    client = _client(api)
    assert client.get("/limited", headers=_auth("tenant-a")).status_code == 200
    assert client.get("/limited", headers=_auth("tenant-a")).status_code == 429
    assert client.get("/limited", headers=_auth("tenant-b")).status_code == 200


def test_a_spoofed_forwarded_address_does_not_open_a_new_window() -> None:
    api = _api()
    api.add_route("GET", "/open", _ok, public=True, limits=[RateLimit(max=1, window_seconds=60)])

    client = _client(api)

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
