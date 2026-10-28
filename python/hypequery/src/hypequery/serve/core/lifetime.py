"""Carry HTTP disconnection and handler cancellation into executor budgets."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress

from .messages import ServeRequest
from .work import RequestWork

_POLL_SECONDS = 0.05


class RequestLifetime:
    """Cancels *work* when the request's caller disconnects or its handler fails.

    Without an `is_disconnected` from the adapter, only handler failure cancels.
    """

    def __init__(self, request: ServeRequest, work: RequestWork) -> None:
        self.cancellation = work.cancellation
        self._is_disconnected = request.is_disconnected
        self._work = work
        self._stopped = asyncio.Event()
        self._watcher: asyncio.Task[None] | None = None

    async def __aenter__(self) -> RequestLifetime:
        # The route's body has already been read, so this cannot consume it.
        if self._is_disconnected is not None:
            self._watcher = asyncio.create_task(self._watch(self._is_disconnected))
        return self

    async def _watch(self, is_disconnected: Callable[[], Awaitable[bool]]) -> None:
        while not self._stopped.is_set() and not self.cancellation.is_set():
            if await is_disconnected():
                self._work.cancel()
                return
            with suppress(TimeoutError):
                await asyncio.wait_for(self._stopped.wait(), _POLL_SECONDS)

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        if exc_type is not None:
            self._work.cancel()
        # Stop the watcher with a flag, never Task.cancel(): Starlette's
        # is_disconnected() awaits inside an already-cancelled anyio
        # CancelScope, which can absorb a cancel aimed at the watcher and
        # leave this exit waiting forever.
        self._stopped.set()
        if self._watcher:
            await self._watcher
