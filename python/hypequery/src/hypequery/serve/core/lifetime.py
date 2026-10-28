"""Carry HTTP disconnection and handler cancellation into executor budgets."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .messages import ServeRequest
from .work import RequestWork


class RequestLifetime:
    """Cancels *work* when the request's caller disconnects or its handler fails.

    Without a `wait_disconnected` from the adapter, only handler failure cancels.
    """

    def __init__(self, request: ServeRequest, work: RequestWork) -> None:
        self.cancellation = work.cancellation
        self._wait_disconnected = request.wait_disconnected
        self._work = work
        self._stopped = asyncio.Event()
        self._watcher: asyncio.Task[None] | None = None

    async def __aenter__(self) -> RequestLifetime:
        # The route's body has already been read, so waiting cannot consume it.
        if self._wait_disconnected is not None:
            self._watcher = asyncio.create_task(self._watch(self._wait_disconnected))
        return self

    async def _watch(self, wait_disconnected: Callable[[], Awaitable[None]]) -> None:
        """Wait, without polling, for the caller to go or the request to end."""

        gone = asyncio.ensure_future(wait_disconnected())
        stopped = asyncio.ensure_future(self._stopped.wait())
        try:
            await asyncio.wait((gone, stopped), return_when=asyncio.FIRST_COMPLETED)
            if gone.done() and not gone.cancelled() and gone.exception() is None:
                self._work.cancel()
        finally:
            # Neither is awaited after cancelling: a host's waiter that absorbs
            # the cancel must not hold the request open.
            gone.cancel()
            stopped.cancel()

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        if exc_type is not None:
            self._work.cancel()
        self._stopped.set()
        if self._watcher:
            await self._watcher
