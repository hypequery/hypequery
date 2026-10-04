"""Production startup, admission, budgets, cancellation and a real server."""

from __future__ import annotations

import asyncio
import socket
import subprocess
import sys
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse
from starlette.types import Message, Receive, Scope, Send

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    count,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.cache import MemoryCacheStore, ResultCache
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.planner import query_settings
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    api_key,
    create_app,
    create_router,
    run_production,
)
from hypequery.serve.production_limits import ProductionLimitsMiddleware

SECURITY = HttpSecurity(allowed_hosts=("testserver",))
HEADERS = {"Authorization": "Bearer test"}


def authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "test" else None


@pytest.mark.parametrize(
    "options",
    [
        {"debug": True},
        {"reload": True},
        {"cookie_auth": True},
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


def test_production_docs_cookie_and_proxy_misuse_fails_at_startup() -> None:
    router = create_router(authenticate=authenticate)
    with pytest.raises(ValueError, match="documentation"):
        create_app(router, security=SECURITY, production=ProductionProfile(), development_docs=True)
    with pytest.raises(ValueError, match="proxy"):
        create_app(
            router,
            security=HttpSecurity(allowed_hosts=("testserver",), trusted_proxies=("0.0.0.0/0",)),
            production=ProductionProfile(),
        )
    with pytest.raises(ValueError, match="cookies"):
        create_app(
            create_router(authenticate=authenticate, credentials=api_key(header="cookie")),
            security=SECURITY,
            production=ProductionProfile(),
        )
    with pytest.raises(ValueError, match="ProductionProfile"):
        run_production(FastAPI())
    assert ProductionProfile(host="0.0.0.0", allow_external_bind=True).host == "0.0.0.0"  # noqa: S104
    assert ProductionProfile(host="::1").host == "::1"


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


def test_query_budgets_tighten_client_settings_and_reserve_pagination_probe() -> None:
    executor = Executor()
    client = create_dataset_client(executor=executor, settings=query_settings(max_threads=1))
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(router, "/query", dataset=DATASET, client=client)
    profile = ProductionProfile(max_result_rows=3, max_result_bytes=1024, timeout_seconds=2)
    with TestClient(create_app(router, security=SECURITY, production=profile)) as http:
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
        router = create_router(authenticate=authenticate)

        @router.get("/hold")
        async def hold() -> None:
            started.set()
            await release.wait()
            raise ValueError("PRIVATE_FAILURE")

        @router.get("/ok")
        async def ok() -> dict[str, bool]:
            return {"ok": True}

        app = create_app(router, security=SECURITY, production=ProductionProfile(max_concurrency=1))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver", headers=HEADERS
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
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(
        router, "/query", dataset=DATASET, client=create_async_dataset_client(executor=executor)
    )
    with TestClient(
        create_app(
            router,
            security=SECURITY,
            production=ProductionProfile(timeout_seconds=1, max_concurrency=1),
        )
    ) as http:
        response = http.post("/query", headers=HEADERS, json={"measures": ["rows"]})
        assert response.status_code == 504
        assert response.json()["error"]["type"] == "GATEWAY_TIMEOUT"
        assert response.headers["x-request-id"]
        assert executor.compiled is not None
        assert executor.compiled.cancellation is not None
        assert executor.compiled.cancellation.is_set()
        assert http.get("/unknown").status_code == 404


def test_oversized_chunked_response_returns_one_canonical_error() -> None:
    router = create_router(authenticate=authenticate)

    @router.get("/large")
    async def large() -> StreamingResponse:
        async def chunks() -> AsyncIterator[bytes]:
            yield b"PRIVATE_ROW" * 60
            yield b"PRIVATE_ROW" * 60

        return StreamingResponse(chunks(), media_type="application/json")

    with TestClient(
        create_app(router, security=SECURITY, production=ProductionProfile(max_result_bytes=1024))
    ) as http:
        response = http.get("/large", headers=HEADERS)
        assert response.status_code == 413
        assert response.json()["error"]["type"] == "PAYLOAD_TOO_LARGE"
        assert "PRIVATE_ROW" not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-request-id"]


def test_response_generation_failure_discards_buffered_rows() -> None:
    router = create_router(authenticate=authenticate)

    @router.get("/broken")
    async def broken() -> StreamingResponse:
        async def chunks() -> AsyncIterator[bytes]:
            yield b"PRIVATE_ROW"
            raise RuntimeError("PRIVATE_DRIVER")

        return StreamingResponse(chunks())

    with TestClient(create_app(router, security=SECURITY, production=ProductionProfile())) as http:
        response = http.get("/broken", headers=HEADERS)
        assert response.status_code == 500
        assert response.json()["error"]["type"] == "INTERNAL_SERVER_ERROR"
        assert "PRIVATE" not in response.text
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

    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(
        router, "/query", dataset=DATASET, client=create_dataset_client(executor=BlockingExecutor())
    )
    with TestClient(
        create_app(router, security=SECURITY, production=ProductionProfile(timeout_seconds=1))
    ) as http:
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
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(
        router,
        "/query",
        dataset=dataset,
        client=create_dataset_client(executor=executor, cache=cache),
    )
    with TestClient(
        create_app(router, security=SECURITY, production=ProductionProfile(max_result_bytes=1024))
    ) as http:
        for _ in range(2):
            response = http.post("/query", headers=HEADERS, json={"dimensions": ["country"]})
            assert response.status_code == 413
            assert "PRIVATE_ROW" not in response.text
        assert executor.calls == 1


def test_stalled_response_send_times_out_without_second_status_and_releases_slot() -> None:
    async def run() -> None:
        messages: list[Message] = []

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        async def receive() -> Message:
            return {"type": "http.disconnect"}

        async def send(message: Message) -> None:
            messages.append(message)
            if message["type"] == "http.response.body":
                await asyncio.sleep(100)

        middleware = ProductionLimitsMiddleware(app, ProductionProfile(timeout_seconds=1))
        with pytest.raises(TimeoutError):
            await middleware({"type": "http"}, receive, send)
        assert [
            message["status"] for message in messages if message["type"] == "http.response.start"
        ] == [200]
        assert middleware.active == 0

    asyncio.run(run())


@pytest.mark.parametrize("trusted", [False, True])
def test_production_proxy_policy(trusted: bool) -> None:
    router = create_router(authenticate=authenticate)

    @router.get("/peer")
    async def peer(request: Request) -> dict[str, str]:
        assert request.client is not None
        return {"host": request.client.host, "scheme": request.url.scheme}

    security = HttpSecurity(
        allowed_hosts=("testserver",), trusted_proxies=("127.0.0.1",) if trusted else ()
    )

    async def run() -> None:
        app = create_app(router, security=security, production=ProductionProfile())
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 123)),
            base_url="http://testserver",
        ) as http:
            response = await http.get(
                "/peer",
                headers={**HEADERS, "X-Forwarded-For": "192.0.2.1", "X-Forwarded-Proto": "https"},
            )
            assert response.json() == {
                "host": "192.0.2.1" if trusted else "127.0.0.1",
                "scheme": "https" if trusted else "http",
            }

    asyncio.run(run())


def test_real_production_runner_keeps_docs_closed_and_ignores_spoofed_proxy() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    source = """
from fastapi import Request
from hypequery.serve import (
    ProductionProfile, Principal, HttpSecurity, create_router, create_app, run_production,
)
router = create_router(authenticate=lambda credential:
    Principal(subject="reader") if credential.value == "test" else None)
@router.get("/peer")
async def peer(request: Request):
    return {"client": request.client.host, "scheme": request.url.scheme}
app = create_app(router, security=HttpSecurity(allowed_hosts=("127.0.0.1",)),
                 production=ProductionProfile(port=PORT))
run_production(app)
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
            assert response.json() == {"client": "127.0.0.1", "scheme": "http"}
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

    router = create_router(authenticate=blocked_auth)
    add_dataset_endpoint(
        router, "/query", dataset=DATASET, client=create_dataset_client(executor=BlockingExecutor())
    )
    application = create_app(
        router,
        security=SECURITY,
        production=ProductionProfile(timeout_seconds=1, max_concurrency=1),
    )

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application), base_url="http://testserver"
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
    from starlette.concurrency import run_in_threadpool

    from hypequery.serve.utils.request_work import request_work, run_sync

    started = threading.Event()
    release = threading.Event()
    calls: list[str] = []

    def occupy_pool() -> None:
        started.set()
        release.wait(5)

    async def run() -> None:
        limiter = anyio.to_thread.current_default_thread_limiter()
        original_tokens = limiter.total_tokens
        limiter.total_tokens = 1
        occupier = asyncio.create_task(run_in_threadpool(occupy_pool))
        try:
            while not started.is_set():
                await asyncio.sleep(0.01)

            async def app(scope: Scope, receive: Receive, send: Send) -> None:
                request = Request(scope)
                try:
                    await run_sync(request, calls.append, "expired work")
                except asyncio.CancelledError:
                    cleanup = request_work(request).start_cleanup(calls.append, "failure telemetry")
                    assert cleanup is None
                    raise
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"ok"})

            async def receive() -> Message:
                return {"type": "http.request", "body": b"", "more_body": False}

            messages: list[Message] = []

            async def send(message: Message) -> None:
                messages.append(message)

            middleware = ProductionLimitsMiddleware(
                app, ProductionProfile(timeout_seconds=1, max_concurrency=1)
            )
            await middleware(
                {"type": "http", "method": "GET", "path": "/", "headers": []}, receive, send
            )
            assert messages[0]["status"] == 504
            await asyncio.sleep(0.05)
            assert middleware.active == 0
            assert calls == []
            assert not release.is_set()
        finally:
            release.set()
            await occupier
            limiter.total_tokens = original_tokens
        await asyncio.sleep(0.05)
        assert calls == []

    asyncio.run(run())
