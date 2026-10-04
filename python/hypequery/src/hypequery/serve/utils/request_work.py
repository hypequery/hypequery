"""Track synchronous request work independently from the cancelled HTTP waiter."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable, MutableMapping
from contextlib import suppress
from typing import Any, ParamSpec, TypeVar, cast

from fastapi import Request
from starlette.concurrency import run_in_threadpool

_P = ParamSpec("_P")
_T = TypeVar("_T")
_WORK_SCOPE_KEY = object()


class RequestWork:
    def __init__(self) -> None:
        self.cancellation = threading.Event()
        self.tasks: set[asyncio.Task[Any]] = set()
        self._states: dict[asyncio.Task[Any], tuple[threading.Event, bool]] = {}

    def start_sync(
        self, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
    ) -> asyncio.Task[_T]:
        return self._start(False, function, *args, **kwargs)

    def start_cleanup(
        self, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
    ) -> asyncio.Task[_T]:
        """Failure telemetry may finish after the request has been cancelled."""
        return self._start(True, function, *args, **kwargs)

    def _start(
        self, cleanup: bool, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
    ) -> asyncio.Task[_T]:
        started = threading.Event()

        def invoke() -> _T:
            started.set()
            # Recheck inside the worker: it may have waited for a pool token
            # until after its HTTP waiter was cancelled.
            if not cleanup and self.cancellation.is_set():
                raise asyncio.CancelledError
            return function(*args, **kwargs)

        task = asyncio.create_task(run_in_threadpool(invoke))
        self.tasks.add(task)
        self._states[task] = (started, cleanup)
        task.add_done_callback(self._finished)
        return task

    def cancel(self) -> None:
        self.cancellation.set()
        for task, (started, cleanup) in tuple(self._states.items()):
            if not cleanup and not started.is_set():
                # Waiting for thread-pool capacity is cancellable. Running
                # workers remain tracked until they actually return.
                task.cancel()

    def _finished(self, task: asyncio.Task[Any]) -> None:
        self.tasks.discard(task)
        self._states.pop(task, None)
        # A cancelled waiter will not retrieve a late worker exception.
        with suppress(asyncio.CancelledError, Exception):
            task.result()

    async def drain(self) -> None:
        while self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)


def request_work(request: Request) -> RequestWork:
    scope = cast(MutableMapping[object, Any], request.scope)
    value = scope.get(_WORK_SCOPE_KEY)
    if not isinstance(value, RequestWork):
        value = RequestWork()
        scope[_WORK_SCOPE_KEY] = value
    return value


async def run_sync(
    request: Request, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
) -> _T:
    # Cancelling the HTTP waiter returns promptly; the worker remains tracked
    # until it finishes, so production admission cannot exceed its work budget.
    return await asyncio.shield(request_work(request).start_sync(function, *args, **kwargs))
