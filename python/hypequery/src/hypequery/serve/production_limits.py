"""Bound admission, total request duration and buffered response bytes."""

from __future__ import annotations

import asyncio

from fastapi import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import ServeError, as_serve_error, error_response
from .production import ProductionProfile
from .utils.production_context import set_production_profile
from .utils.request_work import RequestWork, request_work


class _ResponseTooLargeError(Exception):
    """Internal signal: bypass HTTPException handlers after response.start."""


class ProductionLimitsMiddleware:
    def __init__(self, app: ASGIApp, profile: ProductionProfile) -> None:
        self.app = app
        self.profile = profile
        self.active = 0
        self._draining: set[asyncio.Task[None]] = set()

    async def _release_after_work(self, work: RequestWork) -> None:
        try:
            await work.drain()
        finally:
            self.active -= 1

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self.active >= self.profile.max_concurrency:
            await error_response(
                Request(scope),
                ServeError(503, "SERVICE_UNAVAILABLE", "The server is at capacity."),
            )(scope, receive, send)
            return
        # No await between check and increment: admission is atomic on the loop.
        self.active += 1
        set_production_profile(scope, self.profile)
        work = request_work(Request(scope))
        start: Message | None = None
        body = bytearray()
        committed = False

        async def buffer(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                start = message
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                if len(body) + len(chunk) > self.profile.max_result_bytes:
                    raise _ResponseTooLargeError
                body.extend(chunk)

        try:
            try:
                async with asyncio.timeout(self.profile.timeout_seconds):
                    try:
                        await self.app(scope, receive, buffer)
                    except* _ResponseTooLargeError:
                        # Older Starlette streams wrap send failures in an
                        # AnyIO ExceptionGroup; retain the same 413 on the floor.
                        raise _ResponseTooLargeError from None
                    if start is not None:
                        # No partial oversized response ever reaches the wire.
                        await send(start)
                        committed = True
                        await send({"type": "http.response.body", "body": bytes(body)})
            except TimeoutError:
                work.cancellation.set()
                if committed:
                    # The transport must close a stalled partial response.
                    # A second status line would corrupt the HTTP connection.
                    raise
                await error_response(
                    Request(scope),
                    ServeError(504, "GATEWAY_TIMEOUT", "The query did not finish in time."),
                )(scope, receive, send)
            except _ResponseTooLargeError:
                await error_response(
                    Request(scope),
                    ServeError(413, "PAYLOAD_TOO_LARGE", "The response exceeds its byte limit."),
                )(scope, receive, send)
            except Exception as exc:
                if committed:
                    raise
                request = Request(scope)
                await error_response(request, as_serve_error(exc, request=request))(
                    scope, receive, send
                )
        finally:
            work.cancellation.set()
            if work.tasks:
                # A 504 releases the HTTP caller, but still-running host code
                # keeps its admission slot until its threads have stopped.
                draining = asyncio.create_task(self._release_after_work(work))
                self._draining.add(draining)
                draining.add_done_callback(self._draining.discard)
            else:
                self.active -= 1
