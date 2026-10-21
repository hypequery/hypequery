"""Bounded async admission and RFC 0010 cancellation precedence."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Coroutine
from contextlib import suppress
from typing import TypeVar

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

from .utils.refused_kill import is_refused_kill, report_refused_kill

_T = TypeVar("_T")
_POLL_SECONDS = 0.025
_DRAIN_SECONDS = 2.0
#: Back off between repeated KILL attempts, but keep asking often enough that a
#: query which registered after the first attempt is stopped soon after.
_RETRY_CAP_SECONDS = 5.0
_LOGGER = logging.getLogger(__name__)


class KillRetries:
    """The KILL retries an owner left running, kept referenced until they end.

    Once closed, it cancels those retries and starts no more: a request still
    unwinding when its executor closes must not leave a retry behind.
    """

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()
        self._closed = False

    def __len__(self) -> int:
        return len(self._tasks)

    def start(self, retry: Coroutine[object, object, None]) -> None:
        if self._closed:
            retry.close()
            return
        task = asyncio.create_task(retry)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def close(self) -> None:
        self._closed = True
        pending = tuple(self._tasks)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


#: Retries outlive the request that started them; an executor passes its own
#: KillRetries so closing it can stop them, and anything else shares this one.
_RETRIES = KillRetries()


def server_cancellation_confirmed(response: object) -> bool:
    """KILL ... SYNC returns a finished status only when it matched a query."""
    if isinstance(response, str):
        return response.split("\t", 1)[0] == "finished"
    if isinstance(response, (list, tuple)) and response:
        status: object = response[0]
        return isinstance(status, str) and status == "finished"
    return False


def terminal_error(compiled: CompiledQuery) -> CompiledQueryError | None:
    if compiled.cancellation is not None and compiled.cancellation.is_set():
        return CompiledQueryError("aborted", "The query was cancelled.", query_id=compiled.query_id)
    if compiled.deadline is not None and compiled.deadline.expired():
        return CompiledQueryError(
            "deadline-exceeded", "The query timed out.", query_id=compiled.query_id
        )
    return None


def _wait_interval(compiled: CompiledQuery) -> float:
    if compiled.deadline is None:
        return _POLL_SECONDS
    return max(0.0, min(_POLL_SECONDS, compiled.deadline.remaining()))


async def _drain(task: asyncio.Future[_T]) -> None:
    task.cancel()
    done, _ = await asyncio.wait((task,), timeout=_DRAIN_SECONDS)
    with suppress(asyncio.CancelledError, TimeoutError, Exception):
        if done:
            task.result()


async def _cancel_on_server_preserving_reason(
    query_id: str, cancel_on_server: Callable[[str], Awaitable[object]]
) -> bool:
    """Send one KILL; report whether asking again is pointless.

    That is when the server confirmed a match, or refused the KILL outright.
    """
    try:
        return server_cancellation_confirmed(await cancel_on_server(query_id))
    except Exception as exc:
        # The caller's terminal reason still wins if the control connection fails.
        if is_refused_kill(exc):
            report_refused_kill()
            return True
        _LOGGER.warning("Server cancellation failed for query %s", query_id)
        return False


async def _retry_server_cancellation(
    compiled: CompiledQuery,
    cancel_on_server: Callable[[str], Awaitable[object]],
    pending: Callable[[], bool] | None,
) -> None:
    """Ask again until the server confirms or the driver's work is over.

    The driver may still be submitting when the first KILL runs, so a query
    that registers afterwards would otherwise run to ``max_execution_time``
    while holding its worker slot. *pending* reports whether the driver call is
    still running. With it, retries continue for as long as that call does, as
    the synchronous monitor's do: ``max_execution_time`` bounds execution on
    the server, not how long submission takes, so a slow submission must not
    outlast the retries. Without it, the retries stop at the server's own time
    limit, by which point a query registered within it has ended either way.
    """
    budget = (
        None if pending is not None else time.monotonic() + compiled.settings.max_execution_time
    )
    interval = _POLL_SECONDS
    warned = False
    while budget is None or time.monotonic() < budget:
        await asyncio.sleep(interval)
        if pending is not None and not pending():
            return
        try:
            if server_cancellation_confirmed(await cancel_on_server(compiled.query_id)):
                return
        except Exception as exc:
            if is_refused_kill(exc):
                report_refused_kill()
                return
            if not warned:
                _LOGGER.warning("Server cancellation failed for query %s", compiled.query_id)
                warned = True
        interval = min(interval * 2, _RETRY_CAP_SECONDS)


def _ensure_server_cancellation(
    compiled: CompiledQuery,
    cancel_on_server: Callable[[str], Awaitable[object]],
    pending: Callable[[], bool] | None,
    retries: KillRetries,
) -> None:
    retries.start(_retry_server_cancellation(compiled, cancel_on_server, pending))


async def acquire_slot(semaphore: asyncio.Semaphore, compiled: CompiledQuery) -> None:
    """Wait for admission without ignoring cancellation or an expiring deadline."""

    task = asyncio.create_task(semaphore.acquire())
    handed_off = False
    try:
        while True:
            reason = terminal_error(compiled)
            if reason is not None:
                raise reason
            done, _ = await asyncio.wait((task,), timeout=_wait_interval(compiled))
            if done:
                reason = terminal_error(compiled)
                if reason is not None:
                    raise reason
                handed_off = True
                return
    except asyncio.CancelledError:
        raise CompiledQueryError(
            "aborted", "The query was cancelled.", query_id=compiled.query_id
        ) from None
    finally:
        if not task.done():
            await _drain(task)
        if task.done() and not task.cancelled() and task.exception() is None and not handed_off:
            semaphore.release()


async def run_with_policy(
    work: Awaitable[_T],
    compiled: CompiledQuery,
    cancel_on_server: Callable[[str], Awaitable[object]],
    *,
    pending: Callable[[], bool] | None = None,
    retries: KillRetries | None = None,
) -> _T:
    """Monitor a running query and ask ClickHouse to stop it on interruption.

    *pending* tells whether the driver call behind *work* is still running once
    *work* itself has been abandoned. *retries* collects any KILL retries left
    running after this returns, so their owner can stop them when it closes.
    """

    task = asyncio.ensure_future(work)
    # Set when a KILL went out while the driver call was still running and the
    # server neither confirmed a match nor refused: the query may register after it.
    unconfirmed = False

    async def cancel_now() -> None:
        nonlocal unconfirmed
        in_flight = not task.done()
        settled = await _cancel_on_server_preserving_reason(compiled.query_id, cancel_on_server)
        unconfirmed = in_flight and not settled

    try:
        while True:
            reason = terminal_error(compiled)
            if reason is not None:
                await cancel_now()
                raise reason
            done, _ = await asyncio.wait((task,), timeout=_wait_interval(compiled))
            if done:
                reason = terminal_error(compiled)
                if reason is not None:
                    await cancel_now()
                    raise reason
                return await task
    except asyncio.CancelledError:
        reason = terminal_error(compiled)
        caller_task = asyncio.current_task()
        if reason is None and (caller_task is None or caller_task.cancelling() == 0):
            raise CompiledQueryError("internal", "", query_id=compiled.query_id) from None
        await asyncio.shield(cancel_now())
        raise (
            reason
            or CompiledQueryError("aborted", "The query was cancelled.", query_id=compiled.query_id)
        ) from None
    finally:
        if not task.done():
            await _drain(task)
        if unconfirmed:
            _ensure_server_cancellation(
                compiled, cancel_on_server, pending, _RETRIES if retries is None else retries
            )
