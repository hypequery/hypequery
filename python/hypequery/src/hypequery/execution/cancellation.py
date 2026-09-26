"""Bounded async admission and RFC 0010 cancellation precedence."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import TypeVar

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

_T = TypeVar("_T")
_POLL_SECONDS = 0.025
_DRAIN_SECONDS = 2.0
_LOGGER = logging.getLogger(__name__)


def _terminal_error(compiled: CompiledQuery) -> CompiledQueryError | None:
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
) -> None:
    try:
        await cancel_on_server(query_id)
    except Exception:
        # The caller's terminal reason still wins if the control connection fails.
        _LOGGER.warning("Server cancellation failed for query %s", query_id)


async def acquire_slot(semaphore: asyncio.Semaphore, compiled: CompiledQuery) -> None:
    """Wait for admission without ignoring cancellation or an expiring deadline."""

    task = asyncio.create_task(semaphore.acquire())
    handed_off = False
    try:
        while True:
            reason = _terminal_error(compiled)
            if reason is not None:
                raise reason
            done, _ = await asyncio.wait((task,), timeout=_wait_interval(compiled))
            if done:
                reason = _terminal_error(compiled)
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
) -> _T:
    """Monitor a running query and ask ClickHouse to stop it on interruption."""

    task = asyncio.ensure_future(work)
    try:
        while True:
            reason = _terminal_error(compiled)
            if reason is not None:
                await _cancel_on_server_preserving_reason(compiled.query_id, cancel_on_server)
                raise reason
            done, _ = await asyncio.wait((task,), timeout=_wait_interval(compiled))
            if done:
                reason = _terminal_error(compiled)
                if reason is not None:
                    await _cancel_on_server_preserving_reason(compiled.query_id, cancel_on_server)
                    raise reason
                return await task
    except asyncio.CancelledError:
        reason = _terminal_error(compiled)
        caller_task = asyncio.current_task()
        if reason is None and (caller_task is None or caller_task.cancelling() == 0):
            raise CompiledQueryError("internal", "", query_id=compiled.query_id) from None
        await asyncio.shield(
            _cancel_on_server_preserving_reason(compiled.query_id, cancel_on_server)
        )
        raise (
            reason
            or CompiledQueryError("aborted", "The query was cancelled.", query_id=compiled.query_id)
        ) from None
    finally:
        if not task.done():
            await _drain(task)
