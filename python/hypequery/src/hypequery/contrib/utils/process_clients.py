"""One dataset client per process, for frameworks without a shutdown hook.

Django and Flask build their application at import time and never tell it the
process is stopping. A client created per request would open connections per
request; one created at import time would be shared into forked workers. This
holder creates each client on first use in each process and closes it at
interpreter exit.

The async client runs the sync HTTP driver on worker threads
(:func:`create_async_from_sync_clickhouse_executor`), so no aiohttp session can
outlive its event loop. Its admission queue is bound to one event loop, so the
holder keeps one per live loop: one in total under an ASGI server, and one per
in-flight request when a WSGI server runs async views (each request gets its
own loop there). Executors whose loop has closed are closed on the next call.
"""

from __future__ import annotations

import asyncio
import atexit
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass

from ...datasets import (
    AsyncDatasetClient,
    DatasetClient,
    DatasetRegistry,
    create_async_dataset_client,
    create_dataset_client,
)
from ...datasets.utils.query_timezone import validate_timezone
from ...execution import (
    AsyncFromSyncClickHouseExecutor,
    ClickHouseConnection,
    create_async_from_sync_clickhouse_executor,
    create_clickhouse_executor,
)
from .lazy_executor import LazyExecutor


@dataclass(frozen=True, slots=True)
class ClientConfig:
    """What a process-wide client is built from, validated before anything connects."""

    connection: ClickHouseConnection
    registry: DatasetRegistry | None = None
    timezone: str = "UTC"
    max_concurrent: int = 4

    def __post_init__(self) -> None:
        validate_timezone(self.timezone)
        if type(self.max_concurrent) is not int or not 1 <= self.max_concurrent <= 128:
            raise ValueError("max_concurrent must be an integer between 1 and 128")


@dataclass(frozen=True, slots=True)
class _Sync:
    client: DatasetClient
    executor: LazyExecutor


@dataclass(frozen=True, slots=True)
class _Async:
    client: AsyncDatasetClient
    executor: AsyncFromSyncClickHouseExecutor


class ProcessClients:
    """Lazily built sync and async clients, rebuilt after a fork, closed at exit.

    *config* is called on first use, not at construction, so settings read by
    the framework after import are honoured.
    """

    def __init__(self, config: Callable[[], ClientConfig]) -> None:
        self._config = config
        self._lock = threading.Lock()
        self._pid = os.getpid()
        self._sync: _Sync | None = None
        self._async: dict[asyncio.AbstractEventLoop, _Async] = {}
        self._registered = False

    def _forget_parent(self) -> None:
        # A forked worker inherits the parent's client objects, sockets and all.
        # It must not use them, and closing them here would close the parent's.
        if self._pid != os.getpid():
            self._pid = os.getpid()
            self._sync = None
            self._async = {}

    def _register_close(self) -> None:
        if not self._registered:
            atexit.register(self.close)
            self._registered = True

    def sync(self) -> DatasetClient:
        """The process's sync client."""

        with self._lock:
            self._forget_parent()
            if self._sync is None:
                config = self._config()
                connection = config.connection
                # Connects on the first query: building the client (and the
                # endpoints that hold it) never touches ClickHouse.
                executor = LazyExecutor(lambda: create_clickhouse_executor(connection))
                client = create_dataset_client(
                    executor=executor, registry=config.registry, timezone=config.timezone
                )
                self._sync = _Sync(client, executor)
                self._register_close()
            return self._sync.client

    def async_client(self) -> AsyncDatasetClient:
        """The async client for the running event loop."""

        loop = asyncio.get_running_loop()
        with self._lock:
            self._forget_parent()
            closed = [done for done in self._async if done.is_closed()]
            stale = [self._async.pop(done).executor for done in closed]
            built = self._async.get(loop)
            if built is None:
                config = self._config()
                executor = create_async_from_sync_clickhouse_executor(
                    config.connection, max_concurrent=config.max_concurrent
                )
                client = create_async_dataset_client(
                    executor=executor, registry=config.registry, timezone=config.timezone
                )
                built = self._async[loop] = _Async(client, executor)
                self._register_close()
        for executor in stale:
            executor.close()
        return built.client

    def close(self) -> None:
        """Close whatever this process opened. Safe to call more than once."""

        with self._lock:
            if self._pid != os.getpid():
                return
            built_sync, built_async = self._sync, list(self._async.values())
            self._sync = None
            self._async = {}
        if built_sync is not None:
            built_sync.executor.close()
        for built in built_async:
            built.executor.close()
