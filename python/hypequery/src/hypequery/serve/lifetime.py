"""Carry HTTP disconnection and handler cancellation into executor budgets."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import Request

from .utils.request_work import request_work

_POLL_SECONDS = 0.05


class RequestLifetime:
    def __init__(self, request: Request) -> None:
        self.cancellation = request_work(request).cancellation
        self._request = request
        self._stopped = asyncio.Event()
        self._watcher: asyncio.Task[None] | None = None

    async def __aenter__(self) -> RequestLifetime:
        # The endpoint's body has already been parsed, so this cannot consume it.
        self._watcher = asyncio.create_task(self._watch())
        return self

    async def _watch(self) -> None:
        while not self._stopped.is_set() and not self.cancellation.is_set():
            if await self._request.is_disconnected():
                request_work(self._request).cancel()
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
            request_work(self._request).cancel()
        # Stop the watcher with a flag, never Task.cancel(): Starlette's
        # is_disconnected() awaits inside an already-cancelled anyio
        # CancelScope, which can absorb a cancel aimed at the watcher and
        # leave this exit waiting forever.
        self._stopped.set()
        if self._watcher:
            await self._watcher
