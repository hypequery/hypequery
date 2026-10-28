"""One event loop per process, on its own thread, serving sync hosts.

A WSGI server calls its application on threads that have no event loop. Running
`asyncio.run` per request would build and tear down a loop every time, and
what the core keeps between requests (admission slots, rate-limit windows,
async clients bound to their loop) would be bound to a loop that no longer
exists. Instead, the first request starts one loop thread for the process, and
each request's coroutine runs there while the request's own thread waits.

The waiting thread is not idle. Blocking work that belongs to the request,
reading `wsgi.input`, is handed back to it (`RequestThread.call`), so the loop
never blocks on a socket and a server that ties a request's input to its thread
keeps working. If the waiting thread is interrupted, the coroutine is
cancelled.

The loop starts on first use in each process, so every worker a preloading
server forks starts its own, and it stops at interpreter exit, cancelling
whatever is still running.
"""

from __future__ import annotations

import asyncio
import atexit
import concurrent.futures
import contextlib
import contextvars
import os
import queue
import threading
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

_T = TypeVar("_T")

#: How long shutdown waits for cancelled requests, then for the loop thread.
_SHUTDOWN_SECONDS = 5.0


class RequestThread:
    """The thread a sync request arrived on, while it waits for its coroutine."""

    __slots__ = ("_jobs", "_loop")

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        #: Callables for the waiting thread to run; None once the coroutine is done.
        self._jobs: queue.SimpleQueue[Callable[[], None] | None] = queue.SimpleQueue()

    async def call(self, function: Callable[[], _T]) -> _T:
        """Run *function* on the request's own thread and wait for its result.

        An exception it raises is raised here. A `BaseException` such as
        `SystemExit` interrupts the request's thread instead, which cancels
        this coroutine.
        """

        future: asyncio.Future[_T] = self._loop.create_future()

        def job() -> None:
            try:
                result = function()
            except Exception as exc:
                self._settle(future, exc, None)
            else:
                self._settle(future, None, result)

        self._jobs.put(job)
        return await future

    def _settle(
        self, future: asyncio.Future[_T], error: Exception | None, result: _T | None
    ) -> None:
        def settle() -> None:
            # The coroutine may have been cancelled meanwhile.
            if future.done():
                return
            if error is not None:
                future.set_exception(error)
            else:
                future.set_result(result)  # type: ignore[arg-type]

        # RuntimeError: the loop closed at shutdown, and nothing is waiting.
        with contextlib.suppress(RuntimeError):
            self._loop.call_soon_threadsafe(settle)

    def _serve(self) -> None:
        """Run the coroutine's jobs until it is done."""

        while (job := self._jobs.get()) is not None:
            job()

    def _finish(self) -> None:
        self._jobs.put(None)


class ServingLoop:
    """An event loop running forever on a daemon thread."""

    def __init__(self) -> None:
        self.pid = os.getpid()
        self._loop = asyncio.new_event_loop()
        self._closed = False
        self._thread = threading.Thread(
            target=self._loop.run_forever, name="hypequery.serving-loop", daemon=True
        )
        self._thread.start()

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def loop(self) -> asyncio.AbstractEventLoop:
        return self._loop

    def run(
        self,
        coroutine: Callable[[RequestThread], Coroutine[Any, Any, _T]],
        *,
        context: contextvars.Context | None = None,
    ) -> _T:
        """Run `coroutine(thread)` on the loop, serving its jobs until it returns.

        It runs in *context*, by default a copy of the calling thread's, as
        `asyncio.to_thread` carries context the other way.
        """

        if threading.current_thread() is self._thread:
            raise RuntimeError("a sync adapter cannot be called from its own serving loop")
        thread = RequestThread(self._loop)
        outcome: concurrent.futures.Future[_T] = concurrent.futures.Future()
        started: list[asyncio.Task[_T]] = []
        context = context if context is not None else contextvars.copy_context()

        def finish(task: asyncio.Task[_T]) -> None:
            if task.cancelled():
                outcome.cancel()
            elif (error := task.exception()) is not None:
                outcome.set_exception(error)
            else:
                outcome.set_result(task.result())
            thread._finish()

        def start() -> None:
            try:
                task = self._loop.create_task(coroutine(thread), context=context)
            except BaseException as exc:
                # Raised to the request's thread, not into the loop.
                outcome.set_exception(exc)
                thread._finish()
                return
            started.append(task)
            task.add_done_callback(finish)

        def cancel() -> None:
            # Scheduled after start(), and the loop runs callbacks in order.
            for task in started:
                task.cancel()

        self._loop.call_soon_threadsafe(start)
        try:
            thread._serve()
        except BaseException:
            # The waiting thread was interrupted: nobody will read the answer.
            with contextlib.suppress(RuntimeError):
                self._loop.call_soon_threadsafe(cancel)
            raise
        return outcome.result()

    def close(self) -> None:
        """Cancel what is still running, then stop and close the loop."""

        if self._closed or threading.current_thread() is self._thread:
            return
        self._closed = True
        drained = asyncio.run_coroutine_threadsafe(_drain(), self._loop)
        with contextlib.suppress(
            concurrent.futures.TimeoutError, concurrent.futures.CancelledError
        ):
            drained.result(_SHUTDOWN_SECONDS)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(_SHUTDOWN_SECONDS)
        if not self._thread.is_alive():
            self._loop.close()


async def _drain() -> None:
    current = asyncio.current_task()
    tasks = [task for task in asyncio.all_tasks() if task is not current]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    loop = asyncio.get_running_loop()
    await loop.shutdown_asyncgens()
    await loop.shutdown_default_executor()


_lock = threading.Lock()
_current: ServingLoop | None = None
_registered = False


def serving_loop() -> ServingLoop:
    """This process's serving loop, started on first use."""

    global _current, _registered
    with _lock:
        if _current is None or _current.closed or _current.pid != os.getpid():
            _current = ServingLoop()
            if not _registered:
                atexit.register(close_serving_loop)
                _registered = True
        return _current


def close_serving_loop() -> None:
    """Stop this process's serving loop; the next request starts a new one."""

    global _current
    with _lock:
        current, _current = _current, None
    if current is not None and current.pid == os.getpid():
        current.close()


def _forget_parent_loop() -> None:
    # A forked child has the parent's loop object but not its thread, and may
    # have been forked while another thread held the lock.
    global _current, _lock
    _lock = threading.Lock()
    _current = None


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_forget_parent_loop)
