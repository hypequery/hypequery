"""Track synchronous request work independently from the cancelled HTTP waiter.

Sync host code and sync clients run on AnyIO's default worker threads, the same
pool Starlette uses, so a sync query and a sync FastAPI endpoint share one
capacity. AnyIO is an async runtime, not a web framework, so the core may use it.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, ParamSpec, TypeVar

from anyio import CapacityLimiter, WouldBlock
from anyio.to_thread import current_default_thread_limiter
from anyio.to_thread import run_sync as run_in_worker

_P = ParamSpec("_P")
_T = TypeVar("_T")


class _Skipped(Exception):  # noqa: N818 - internal signal, never escapes RequestWork
    """Request-thread work skipped because its request was cancelled first."""


#: The started flag of work that cannot be cancelled once handed over.
_RUNNING = threading.Event()
_RUNNING.set()


class RequestWork:
    def __init__(self) -> None:
        self.cancellation = threading.Event()
        self.tasks: set[asyncio.Task[Any]] = set()
        self._states: dict[asyncio.Task[Any], tuple[threading.Event, bool]] = {}

    def start_sync(
        self, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
    ) -> asyncio.Task[_T]:
        return self._start(None, function, *args, **kwargs)

    def start_cleanup(
        self, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
    ) -> asyncio.Task[_T] | None:
        """Failure telemetry runs only with an immediately available worker slot."""
        limiter = current_default_thread_limiter()
        lease = object()
        try:
            limiter.acquire_on_behalf_of_nowait(lease)
        except WouldBlock:
            return None
        return self._start((limiter, lease), function, *args, **kwargs)

    def _start(
        self,
        lease: tuple[CapacityLimiter, object] | None,
        function: Callable[_P, _T],
        *args: _P.args,
        **kwargs: _P.kwargs,
    ) -> asyncio.Task[_T]:
        started = threading.Event()
        cleanup = lease is not None

        def invoke() -> _T:
            started.set()
            # Recheck inside the worker: it may have waited for a pool token
            # until after its HTTP waiter was cancelled.
            if not cleanup and self.cancellation.is_set():
                raise asyncio.CancelledError
            return function(*args, **kwargs)

        async def run() -> _T:
            if lease is None:
                return await run_in_worker(invoke)
            try:
                # The shared token is already reserved. Use a private one-token
                # limiter to dispatch without acquiring a second shared token.
                return await run_in_worker(invoke, limiter=CapacityLimiter(1))
            finally:
                lease[0].release_on_behalf_of(lease[1])

        task = asyncio.create_task(run())
        self.tasks.add(task)
        self._states[task] = (started, cleanup)
        task.add_done_callback(self._finished)
        return task

    def start_on_thread(
        self, runner: Callable[[Callable[[], _T]], Awaitable[_T]], function: Callable[[], _T]
    ) -> asyncio.Task[_T]:
        """Run *function* through a sync host's request-thread *runner*, tracked.

        Like a worker, the thread cannot be interrupted: the task is never
        cancelled, and stays in `tasks` until *function* has returned, so a
        production slot is held until then.
        """

        def invoke() -> _T:
            # The request may have been cancelled before the thread got to it.
            # An ordinary exception, so the runner settles its future with it:
            # `CancelledError` would escape a host thread's job unsettled and
            # leave this task, and the request's slot, waiting forever.
            if self.cancellation.is_set():
                raise _Skipped
            return function()

        async def run() -> _T:
            try:
                return await runner(invoke)
            except _Skipped:
                raise asyncio.CancelledError from None

        task = asyncio.create_task(run())
        self.tasks.add(task)
        self._states[task] = (_RUNNING, True)
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
            pending = tuple(self.tasks)
            await asyncio.gather(*pending, return_exceptions=True)
            # Gathering already-finished tasks can return without yielding on
            # Python 3.12+. Retire them here rather than spinning while their
            # queued done callbacks wait for the event loop to run.
            for task in pending:
                self._finished(task)


async def run_sync(
    work: RequestWork, function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
) -> _T:
    # Cancelling the HTTP waiter returns promptly; the worker remains tracked
    # until it finishes, so production admission cannot exceed its work budget.
    return await asyncio.shield(work.start_sync(function, *args, **kwargs))


async def run_on_thread(
    work: RequestWork,
    runner: Callable[[Callable[[], _T]], Awaitable[_T]],
    function: Callable[[], _T],
) -> _T:
    """Run *function* on a sync host's request thread, tracked by *work*.

    Cancelling the waiter returns promptly; *function* keeps its production
    slot until it returns, as `run_sync`'s workers do.
    """

    return await asyncio.shield(work.start_on_thread(runner, function))
