"""Per-process clients and the prefix-mount helpers shared by the integrations."""

from __future__ import annotations

import asyncio
import os
from collections.abc import MutableMapping
from typing import Any

import pytest

from contrib_doubles import REGISTRY, Built, install_executors, query
from hypequery.contrib.utils.asgi_mount import mount_asgi, validate_prefix
from hypequery.contrib.utils.process_clients import ClientConfig, ProcessClients
from hypequery.contrib.utils.tenant_value import bind_tenant_value
from hypequery.contrib.utils.wsgi_mount import mount_wsgi
from hypequery.datasets import DatasetClient, TenantDatasetClient
from hypequery.datasets.planner import tenant
from hypequery.execution import ClickHouseConnection

CONFIG = ClientConfig(ClickHouseConnection(host="ch"), REGISTRY, "Europe/Paris", 7)


@pytest.fixture
def built(monkeypatch: pytest.MonkeyPatch) -> Built:
    return install_executors(monkeypatch)


def test_sync_client_is_built_once_on_first_use(built: Built) -> None:
    reads: list[int] = []

    def config() -> ClientConfig:
        reads.append(1)
        return CONFIG

    clients = ProcessClients(config)
    assert reads == []
    first = clients.sync()
    assert clients.sync() is first
    assert first.default_timezone == "Europe/Paris"
    # Building the client does not connect; the first query does.
    assert built.sync == []
    query(first)
    query(first)
    assert len(built.sync) == 1
    assert built.sync[0].connection.host == "ch"
    clients.close()
    clients.close()
    assert built.sync[0].closed == 1
    assert clients.sync() is not first


def test_close_is_registered_at_exit_once(built: Built, monkeypatch: pytest.MonkeyPatch) -> None:
    registered: list[object] = []
    monkeypatch.setattr("atexit.register", registered.append)
    clients = ProcessClients(lambda: CONFIG)
    clients.sync()
    clients.close()
    clients.sync()
    assert registered == [clients.close]


def test_a_forked_child_rebuilds_without_closing_the_parents(
    built: Built, monkeypatch: pytest.MonkeyPatch
) -> None:
    clients = ProcessClients(lambda: CONFIG)
    parent = clients.sync()
    query(parent)
    monkeypatch.setattr(os, "getpid", lambda: -1)
    child = clients.sync()
    assert child is not parent
    query(child)
    assert len(built.sync) == 2
    assert built.sync[0].closed == 0
    monkeypatch.undo()
    # Back in "the parent", close() belongs to whichever pid owns the holder now.
    clients.close()
    assert built.sync[0].closed == 0


def test_async_clients_are_one_per_live_loop(built: Built) -> None:
    clients = ProcessClients(lambda: CONFIG)

    async def twice() -> tuple[object, object]:
        return clients.async_client(), clients.async_client()

    first, again = asyncio.run(twice())
    assert first is again
    assert built.async_[0].max_concurrent == 7
    # The first loop is closed now; the next loop gets a new executor and the
    # stale one is closed.
    second, _ = asyncio.run(twice())
    assert second is not first
    assert [executor.closed for executor in built.async_] == [1, 0]
    clients.close()
    assert [executor.closed for executor in built.async_] == [1, 1]


def test_concurrent_loops_each_get_their_own(built: Built) -> None:
    clients = ProcessClients(lambda: CONFIG)
    first_loop = asyncio.new_event_loop()
    second_loop = asyncio.new_event_loop()

    async def get() -> object:
        return clients.async_client()

    try:
        first = first_loop.run_until_complete(get())
        second = second_loop.run_until_complete(get())
        assert first is not second
        assert first_loop.run_until_complete(get()) is first
        assert [executor.closed for executor in built.async_] == [0, 0]
    finally:
        first_loop.close()
        second_loop.close()
        clients.close()


def test_async_client_needs_a_running_loop(built: Built) -> None:
    with pytest.raises(RuntimeError):
        ProcessClients(lambda: CONFIG).async_client()


def test_tenant_values_bind_or_pass_through(built: Built) -> None:
    client = ProcessClients(lambda: CONFIG).sync()
    assert bind_tenant_value(client, None) is client
    assert isinstance(bind_tenant_value(client, "org_a"), TenantDatasetClient)
    assert isinstance(bind_tenant_value(client, tenant("org_a")), TenantDatasetClient)
    with pytest.raises(TypeError, match="tenant id"):
        bind_tenant_value(client, 42)  # type: ignore[call-overload]
    assert isinstance(client, DatasetClient)


@pytest.mark.parametrize("prefix", ["", "/", "analytics", "/analytics/", "//x", "/a?b", 3])
def test_mount_prefixes_are_validated(prefix: Any) -> None:
    with pytest.raises(ValueError, match="mount prefix"):
        validate_prefix(prefix)


Scope = MutableMapping[str, Any]


def _recorder(name: str, seen: list[tuple[str, Scope]]) -> Any:
    async def app(scope: Scope, receive: Any, send: Any) -> None:
        seen.append((name, scope))

    return app


async def _noop_receive() -> MutableMapping[str, Any]:
    return {}


async def _noop_send(message: MutableMapping[str, Any]) -> None:
    return None


async def _call(app: Any, scope: Scope) -> None:
    await app(scope, _noop_receive, _noop_send)


@pytest.mark.parametrize(
    ("scope", "target", "path", "root_path"),
    [
        ({"type": "http", "path": "/analytics/q"}, "mounted", "/analytics/q", "/analytics"),
        ({"type": "http", "path": "/analytics"}, "mounted", "/analytics", "/analytics"),
        ({"type": "websocket", "path": "/analytics/ws"}, "mounted", "/analytics/ws", "/analytics"),
        ({"type": "http", "path": "/analyticsx"}, "host", "/analyticsx", None),
        ({"type": "http", "path": "/"}, "host", "/", None),
        # A server that includes root_path in path, and one that does not.
        (
            {"type": "http", "path": "/app/analytics/q", "root_path": "/app"},
            "mounted",
            "/app/analytics/q",
            "/app/analytics",
        ),
        (
            {"type": "http", "path": "/analytics/q", "root_path": "/app"},
            "mounted",
            "/app/analytics/q",
            "/app/analytics",
        ),
    ],
)
def test_asgi_mount_routes_by_prefix(
    scope: Scope, target: str, path: str, root_path: str | None
) -> None:
    seen: list[tuple[str, Scope]] = []
    app = mount_asgi(_recorder("host", seen), _recorder("mounted", seen), prefix="/analytics")
    asyncio.run(_call(app, dict(scope)))
    [(name, received)] = seen
    assert name == target
    assert received["path"] == path
    assert received.get("root_path") == root_path


@pytest.mark.parametrize("lifespan", ["host", "mounted"])
def test_asgi_mount_sends_lifespan_to_one_app(lifespan: Any) -> None:
    seen: list[tuple[str, Scope]] = []
    app = mount_asgi(
        _recorder("host", seen), _recorder("mounted", seen), prefix="/a", lifespan=lifespan
    )
    asyncio.run(_call(app, {"type": "lifespan"}))
    assert [name for name, _ in seen] == [lifespan]


def test_asgi_mount_lifespan_choice_is_checked() -> None:
    with pytest.raises(ValueError, match="lifespan"):
        mount_asgi(_recorder("h", []), _recorder("m", []), prefix="/a", lifespan="both")  # type: ignore[arg-type]


def test_wsgi_mount_routes_by_prefix() -> None:
    async def mounted(scope: Scope, receive: Any, send: Any) -> None:
        body = f"{scope['root_path']}|{scope['path']}".encode()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    def host(environ: dict[str, Any], start_response: Any) -> list[bytes]:
        start_response("200 OK", [])
        return [b"host:" + environ["PATH_INFO"].encode()]

    app = mount_wsgi(host, mounted, prefix="/analytics")

    from werkzeug.test import Client

    client = Client(app)
    assert client.get("/analytics/q").get_data() == b"/analytics|/analytics/q"
    assert client.get("/analyticsx").get_data() == b"host:/analyticsx"
    assert client.get("/").get_data() == b"host:/"


def test_wsgi_mount_explains_a_missing_a2wsgi(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys

    monkeypatch.setitem(sys.modules, "a2wsgi", None)
    with pytest.raises(ModuleNotFoundError, match=r"hypequery\[flask\]"):
        mount_wsgi(lambda environ, start: [], _recorder("m", []), prefix="/a")


def test_a_closed_lazy_client_refuses_to_reconnect(built: Built) -> None:
    clients = ProcessClients(lambda: CONFIG)
    client = clients.sync()
    clients.close()
    with pytest.raises(RuntimeError, match="closed"):
        query(client)
    assert built.sync == []


class _Executor:
    def __init__(self) -> None:
        self.closed = 0

    def execute(self, compiled: object) -> str:
        return "rows"

    def close(self) -> None:
        self.closed += 1


def test_overlapping_first_queries_connect_once() -> None:
    import threading

    from hypequery.contrib.utils.lazy_executor import LazyExecutor

    started = threading.Event()
    release = threading.Event()
    connects: list[_Executor] = []

    def connect() -> _Executor:
        started.set()
        release.wait(timeout=5)  # hold the first connect so the others overlap it
        connects.append(_Executor())
        return connects[-1]

    lazy = LazyExecutor(connect)  # type: ignore[arg-type]
    results: list[object] = []
    threads = [
        threading.Thread(target=lambda: results.append(lazy.execute(object())))  # type: ignore[arg-type]
        for _ in range(8)
    ]
    for thread in threads:
        thread.start()
    assert started.wait(timeout=5)
    release.set()
    for thread in threads:
        thread.join(timeout=5)
    assert len(connects) == 1
    assert results == ["rows"] * 8
    assert lazy.connected


def test_a_failed_connect_is_retried_by_the_next_query() -> None:
    from hypequery.contrib.utils.lazy_executor import LazyExecutor

    attempts: list[int] = []

    def connect() -> _Executor:
        attempts.append(1)
        if len(attempts) == 1:
            raise ConnectionError("ClickHouse is down")
        return _Executor()

    lazy = LazyExecutor(connect)  # type: ignore[arg-type]
    with pytest.raises(ConnectionError):
        lazy.execute(object())  # type: ignore[arg-type]
    assert not lazy.connected
    assert lazy.execute(object()) == "rows"  # type: ignore[arg-type,comparison-overlap]
    assert len(attempts) == 2
    lazy.close()
    lazy.close()
