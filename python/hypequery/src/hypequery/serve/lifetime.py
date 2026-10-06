"""Carry HTTP disconnection and handler cancellation into executor budgets."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import Request

from .utils.request_work import request_work


class RequestLifetime:
    def __init__(self, request: Request) -> None:
        self.cancellation = request_work(request).cancellation
        self._request = request
        self._watcher: asyncio.Task[None] | None = None

    async def __aenter__(self) -> RequestLifetime:
        # The endpoint's body has already been parsed, so this cannot consume it.
        self._watcher = asyncio.create_task(self._watch())
        return self

    async def _watch(self) -> None:
        while not self.cancellation.is_set():
            if await self._request.is_disconnected():
                request_work(self._request).cancel()
                return
            await asyncio.sleep(0.05)

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        if exc_type is not None:
            request_work(self._request).cancel()
        if self._watcher:
            self._watcher.cancel()
            with suppress(asyncio.CancelledError):
                await self._watcher
