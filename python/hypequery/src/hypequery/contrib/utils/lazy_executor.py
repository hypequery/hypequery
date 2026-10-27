"""A sync executor that connects on its first query.

Django and Flask build their applications at import time, and hypequery's HTTP
endpoints need a dataset client when they are installed. Building the process's
client around this executor means neither connects to ClickHouse until a query
runs: an app imports, and its endpoints install, while ClickHouse is down.
"""

from __future__ import annotations

import threading
from collections.abc import Callable

from ...datasets import CompiledQuery
from ...execution import ClickHouseExecutor, QueryRows


class LazyExecutor:
    def __init__(self, connect: Callable[[], ClickHouseExecutor]) -> None:
        self._connect = connect
        self._executor: ClickHouseExecutor | None = None
        self._lock = threading.Lock()
        self._closed = False

    def _get(self) -> ClickHouseExecutor:
        executor = self._executor
        if executor is not None:
            return executor
        with self._lock:
            if self._closed:
                raise RuntimeError("this hypequery client has been closed")
            if self._executor is None:
                self._executor = self._connect()
            return self._executor

    @property
    def connected(self) -> bool:
        return self._executor is not None

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        return self._get().execute(compiled)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.close()
