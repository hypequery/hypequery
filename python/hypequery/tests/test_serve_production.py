"""Production startup, admission, budgets, cancellation and a real server."""

from __future__ import annotations

import asyncio
import socket
import subprocess
import sys
import threading
import time
from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest

from asgi_client import AsgiClient
from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.aggregations import (
    count,
)
from hypequery.datasets.cache import MemoryCacheStore, ResultCache
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.planner import query_settings
from hypequery.serve import (
    Api,
    Call,
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    ServeRequest,
    ServeResponse,
    add_dataset_endpoint,
    api_key,
    create_api,
    from_context,
    run_production,
    to_asgi_app,
)
from hypequery.serve.core.work import run_sync

Message = MutableMapping[str, Any]

SECURITY = HttpSecurity(allowed_hosts=("testserver",))
HEADERS = {"Authorization": "Bearer test"}


def authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "test" else None


@pytest.mark.parametrize(
    "options",
    [
        {"debug": True},
        {"reload": True},
        {"host": "0.0.0.0"},  # noqa: S104 - verify rejection, no socket is opened
        {"host": "::"},
        {"host": "localhost"},
        {"max_concurrency": 0},
        {"max_concurrency": True},
        {"timeout_seconds": 0},
        {"timeout_seconds": 1.5},
        {"max_result_rows": 1},
        {"max_result_bytes": 0},
        {"allow_external_bind": "yes"},
        {"port": 65536},
    ],
)
def test_invalid_profile_fails_at_startup(options: dict[str, object]) -> None:
    with pytest.raises((TypeError, ValueError)):
        ProductionProfile(**options)  # type: ignore[arg-type]


def test_production_docs_and_proxy_misuse_fails_at_startup() -> None:
    with pytest.raises(ValueError, match="documentation"):
        create_api(
            auth=authenticate,
            security=SECURITY,
            production=ProductionProfile(),
            development_docs=True,
        )
    with pytest.raises(ValueError, match="proxy"):
        create_api(
            auth=authenticate,
            security=HttpSecurity(allowed_hosts=("testserver",), trusted_proxies=("0.0.0.0/0",)),
            production=ProductionProfile(),
        )
    with pytest.raises(ValueError, match="trusted hosts"):
        create_api(auth=authenticate, production=ProductionProfile())
    with pytest.raises(ValueError, match="ProductionProfile"):
        run_production(create_api(auth=authenticate, security=SECURITY))
    with pytest.raises(TypeError, match="to_asgi_app"):
        run_production(object())  # type: ignore[arg-type]
    assert ProductionProfile(host="0.0.0.0", allow_external_bind=True).host == "0.0.0.0"  # noqa: S104
    assert ProductionProfile(host="::1").host == "::1"


def _signed_in(request: ServeRequest) -> Principal:
    return Principal(subject="reader")


def test_production_accepts_context_auth_only_with_its_same_origin_check() -> None:
    """Decision 0023 §5: the same-origin rule replaces the flat cookie ban."""

    api = create_api(
        auth=from_context(_signed_in), security=SECURITY, production=ProductionProfile()
    )
    assert api.authentication.context is not None
    assert api.authentication.context.same_origin is True
    with pytest.raises(ValueError, match="same_origin=False"):
        create_api(
            auth=from_context(_signed_in, same_origin=False),
            security=SECURITY,
            production=ProductionProfile(),
        )
    # Without production, a host may turn the check off.
    assert create_api(auth=from_context(_signed_in, same_origin=False), security=SECURITY)
    # A cookie is never a header credential, in production or not.
    with pytest.raises(ValueError, match="from_context"):
        api_key(header="cookie")
    with pytest.raises(TypeError):
        ProductionProfile(cookie_auth=False)  # type: ignore[call-arg]


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...] = ("rows",)
    rows: tuple[tuple[ResultScalar, ...], ...] = ((1,),)


@dataclass
class Executor:
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        return Rows()


DATASET = Dataset(
    name="one",
    source="system.one",
    dimensions={"dummy": dimension("number")},
    measures={"rows": measure(count("dummy"))},
)


def _production_api(
    profile: ProductionProfile, *, auth: Any = authenticate, security: HttpSecurity = SECURITY
) -> Api:
    return create_api(auth=auth, security=security, production=profile)


def test_query_budgets_tighten_client_settings_and_reserve_pagination_probe() -> None:
    executor = Executor()
    client = create_dataset_client(executor=executor, settings=query_settings(max_threads=1))
    profile = ProductionProfile(max_result_rows=3, max_result_bytes=1024, timeout_seconds=2)
    api = _production_api(profile)
    add_dataset_endpoint(api, "/query", dataset=DATASET, client=client)
    with AsgiClient(to_asgi_app(api)) as http:
        response = http.post(
            "/query",
            headers=HEADERS,
            json={"measures": ["rows"], "limit": 100, "includeMeta": True},
        )
        assert response.status_code == 200
        assert response.json()["meta"]["pagination"]["limit"] == 2
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert http.get(path).status_code == 404
    compiled = executor.seen[0]
    assert compiled.sql.endswith("LIMIT 3")
    assert compiled.settings.values == {
        "readonly": 1,
        "max_execution_time": 2,
        "max_result_rows": 3,
        "max_result_bytes": 1024,
        "max_threads": 1,
    }
    assert compiled.deadline is not None
    assert compiled.deadline.remaining() <= 2
    assert compiled.cancellation is not None
    assert compiled.cancellation.is_set()


def test_capacity_rejects_without_queue_and_recovers_after_failure() -> None:
    async def run() -> None:
        started, release = asyncio.Event(), asyncio.Event()

        async def hold(call: Call) -> ServeResponse:
            started.set()
            await release.wait()
            raise ValueError("PRIVATE_FAILURE")

        async def ok(call: Call) -> ServeResponse:
            return ServeResponse.json({"ok": True})

        api = _production_api(ProductionProfile(max_concurrency=1))
        api.add_route("GET", "/hold", hold)
        api.add_route("GET", "/ok", ok)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=to_asgi_app(api)),
            base_url="http://testserver",
            headers=HEADERS,
        ) as http:
            task = asyncio.create_task(http.get("/hold"))
            await asyncio.wait_for(started.wait(), 2)
            try:
                denied = await http.get("/ok")
                assert denied.status_code == 503
                assert denied.json()["error"]["type"] == "SERVICE_UNAVAILABLE"
                assert denied.headers["cache-control"] == "no-store"
                assert denied.headers["x-request-id"]
            finally:
                release.set()
                failed = await task
            assert failed.status_code == 500
            assert "PRIVATE_FAILURE" not in failed.text
            assert (await http.get("/ok")).status_code == 200

    asyncio.run(run())


def test_total_timeout_cancels_executor_and_releases_capacity() -> None:
    class SlowExecutor:
        compiled: CompiledQuery | None = None

        async def execute(self, compiled: CompiledQuery) -> Rows:
            self.compiled = compiled
            await asyncio.sleep(100)
            return Rows()

    executor = SlowExecutor()
    api = _production_api(ProductionProfile(timeout_seconds=1, max_concurrency=1))
    add_dataset_endpoint(
        api, "/query", dataset=DATASET, client=create_async_dataset_client(executor=executor)
    )
    with AsgiClient(to_asgi_app(api)) as http:
        response = http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
        assert response.status_code == 504
        assert response.json()["error"]["type"] == "GATEWAY_TIMEOUT"
        assert response.headers["x-request-id"]
        assert executor.compiled is not None
        assert executor.compiled.cancellation is not None
        assert executor.compiled.cancellation.is_set()
        assert http.get("/unknown").status_code == 404


def test_an_oversized_response_returns_one_canonical_error() -> None:
    async def large(call: Call) -> ServeResponse:
        return ServeResponse.json({"rows": "PRIVATE_ROW" * 120})

    api = _production_api(ProductionProfile(max_result_bytes=1024))
    api.add_route("GET", "/large", large)
    with AsgiClient(to_asgi_app(api)) as http:
        response = http.get("/large", headers=HEADERS)
        assert response.status_code == 413
        assert response.json()["error"]["type"] == "PAYLOAD_TOO_LARGE"
        assert "PRIVATE_ROW" not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-request-id"]


def test_timeout_signals_sync_executor_running_in_threadpool() -> None:
    stopped = threading.Event()

    class BlockingExecutor:
        def execute(self, compiled: CompiledQuery) -> Rows:
            assert compiled.cancellation is not None
            until = time.monotonic() + 5
            while not compiled.cancellation.is_set() and time.monotonic() < until:
                time.sleep(0.01)
            stopped.set()
            return Rows()

    api = _production_api(ProductionProfile(timeout_seconds=1))
    add_dataset_endpoint(
        api, "/query", dataset=DATASET, client=create_dataset_client(executor=BlockingExecutor())
    )
    with AsgiClient(to_asgi_app(api)) as http:
        response = http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
        assert response.status_code == 504
        assert stopped.wait(2)


def test_cached_rows_cannot_bypass_response_byte_ceiling() -> None:
    class LargeExecutor:
        calls = 0

        def execute(self, compiled: CompiledQuery) -> Rows:
            self.calls += 1
            return Rows(columns=("country",), rows=(("PRIVATE_ROW" * 150,),))

    executor = LargeExecutor()
    cache = ResultCache(store=MemoryCacheStore(), project="test", environment="ci", ttl_seconds=60)
    dataset = Dataset(name="orders", source="orders", dimensions={"country": dimension("string")})
    api = _production_api(ProductionProfile(max_result_bytes=1024))
    add_dataset_endpoint(
        api,
        "/query",
        dataset=dataset,
        client=create_dataset_client(executor=executor, cache=cache),
    )
    with AsgiClient(to_asgi_app(api)) as http:
        for _ in range(2):
            response = http.post("/query", headers=HEADERS, json={"dimensions": ["country"]})
            assert response.status_code == 413
            assert "PRIVATE_ROW" not in response.text
        assert executor.calls == 1


def test_stalled_response_send_times_out_without_second_status_and_releases_slot() -> None:
    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    api = _production_api(ProductionProfile(timeout_seconds=1))
    api.add_route("GET", "/ok", ok, public=True)
    app = to_asgi_app(api)

    async def run() -> None:
        messages: list[Message] = []

        async def receive() -> Message:
            return {"type": "http.disconnect"}

        async def send(message: Message) -> None:
            messages.append(message)
            if message["type"] == "http.response.body":
                await asyncio.sleep(100)

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/ok",
            "raw_path": b"/ok",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
            "client": ("127.0.0.1", 1),
        }
        with pytest.raises(TimeoutError):
            await app(scope, receive, send)
        assert [
            message["status"] for message in messages if message["type"] == "http.response.start"
        ] == [200]
        assert api._gate is not None
        assert api._gate.active == 0

    asyncio.run(run())


@pytest.mark.parametrize("trusted", [False, True])
def test_production_proxy_policy(trusted: bool) -> None:
    async def peer(call: Call) -> ServeResponse:
        assert call.request.client is not None
        return ServeResponse.json({"host": call.request.client[0]})

    security = HttpSecurity(
        allowed_hosts=("testserver",), trusted_proxies=("127.0.0.1",) if trusted else ()
    )
    api = _production_api(ProductionProfile(), security=security)
    api.add_route("GET", "/peer", peer)

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=to_asgi_app(api), client=("127.0.0.1", 123)),
            base_url="http://testserver",
        ) as http:
            response = await http.get(
                "/peer",
                headers={**HEADERS, "X-Forwarded-For": "192.0.2.1", "X-Forwarded-Proto": "https"},
            )
            assert response.json() == {"host": "192.0.2.1" if trusted else "127.0.0.1"}

    asyncio.run(run())


def test_real_production_runner_keeps_docs_closed_and_ignores_spoofed_proxy() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    source = """
from hypequery.serve import (
    ProductionProfile, Principal, HttpSecurity, ServeResponse, create_api, run_production,
)
api = create_api(
    auth=lambda credential: Principal(subject="reader") if credential.value == "test" else None,
    security=HttpSecurity(allowed_hosts=("127.0.0.1",)),
    production=ProductionProfile(port=PORT),
)
async def peer(call):
    return ServeResponse.json({"client": call.request.client[0]})
api.add_route("GET", "/peer", peer)
run_production(api)
""".replace("PORT", str(port))
    process = subprocess.Popen(
        [sys.executable, "-c", source], stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    try:
        with httpx.Client(base_url="http://127.0.0.1:" + str(port), timeout=1) as http:
            until = time.monotonic() + 10
            while True:
                try:
                    response = http.get("/peer")
                    break
                except httpx.ConnectError:
                    if process.poll() is not None or time.monotonic() >= until:
                        pytest.fail("production server failed to start")
                    time.sleep(0.02)
            assert response.status_code == 401
            response = http.get(
                "/peer",
                headers={**HEADERS, "X-Forwarded-For": "192.0.2.1", "X-Forwarded-Proto": "https"},
            )
            assert response.json() == {"client": "127.0.0.1"}
            assert "server" not in response.headers
            assert http.get("/docs").status_code == 404
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()


@pytest.mark.parametrize("blocking", ["authentication", "query"])
def test_sync_deadline_returns_promptly_and_retains_capacity_until_worker_stops(
    blocking: str,
) -> None:
    release = threading.Event()
    finished = threading.Event()
    cancellation: list[object] = []

    def blocked_auth(credential: Credential) -> Principal | None:
        if blocking == "authentication" and not release.is_set():
            try:
                release.wait(5)
            finally:
                finished.set()
        return authenticate(credential)

    class BlockingExecutor:
        def execute(self, compiled: CompiledQuery) -> Rows:
            if blocking == "query" and not release.is_set():
                cancellation.append(compiled.cancellation)
                try:
                    release.wait(5)
                finally:
                    finished.set()
            return Rows()

    api = _production_api(
        ProductionProfile(timeout_seconds=1, max_concurrency=1), auth=blocked_auth
    )
    add_dataset_endpoint(
        api, "/query", dataset=DATASET, client=create_dataset_client(executor=BlockingExecutor())
    )

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=to_asgi_app(api)), base_url="http://testserver"
        ) as http:
            try:
                started = time.monotonic()
                response = await http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
                assert response.status_code == 504, response.text
                assert time.monotonic() - started < 1.8
                if blocking == "query":
                    assert cancellation
                    assert cancellation[0] is not None
                    assert isinstance(cancellation[0], threading.Event)
                    assert cancellation[0].is_set()
                assert not finished.is_set()
                busy = await http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
                assert busy.status_code == 503
            finally:
                release.set()
            until = time.monotonic() + 2
            while not finished.is_set() and time.monotonic() < until:
                await asyncio.sleep(0.01)
            assert finished.is_set()
            # Give the tracked worker and admission callbacks time to run.
            await asyncio.sleep(0.05)
            response = await http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
            assert response.status_code == 200, response.text

    asyncio.run(run())


def test_expired_queued_work_is_cancelled_before_a_thread_pool_token_is_available() -> None:
    import anyio.to_thread

    started = threading.Event()
    release = threading.Event()
    calls: list[str] = []

    def occupy_pool() -> None:
        started.set()
        release.wait(5)

    async def queued(call: Call) -> ServeResponse:
        try:
            await run_sync(call.state.work, calls.append, "expired work")
        except asyncio.CancelledError:
            cleanup = call.state.work.start_cleanup(calls.append, "failure telemetry")
            assert cleanup is None
            raise
        return ServeResponse.json({})

    api = _production_api(ProductionProfile(timeout_seconds=1, max_concurrency=1))
    api.add_route("GET", "/queued", queued, public=True)

    async def run() -> None:
        limiter = anyio.to_thread.current_default_thread_limiter()
        original_tokens = limiter.total_tokens
        limiter.total_tokens = 1
        occupier = asyncio.create_task(anyio.to_thread.run_sync(occupy_pool))
        try:
            while not started.is_set():
                await asyncio.sleep(0.01)
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=to_asgi_app(api)), base_url="http://testserver"
            ) as http:
                response = await http.get("/queued")
            assert response.status_code == 504
            await asyncio.sleep(0.05)
            assert api._gate is not None
            assert api._gate.active == 0
            assert calls == []
            assert not release.is_set()
        finally:
            release.set()
            await occupier
            limiter.total_tokens = original_tokens
        await asyncio.sleep(0.05)
        assert calls == []

    asyncio.run(run())
