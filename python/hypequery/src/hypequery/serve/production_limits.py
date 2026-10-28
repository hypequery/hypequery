"""Bound admission, total request duration and buffered response bytes.

The budgets and admission are the core's (`core/production_limits.py`); this
middleware applies them to every route of a FastAPI application, buffering
whatever the application sends so no oversized response reaches the wire.
"""

from __future__ import annotations

import asyncio

from fastapi import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .core.production_limits import ProductionGate, at_capacity, timed_out, too_large
from .errors import as_serve_error, error_response
from .production import ProductionProfile
from .utils.production_context import set_production_profile
from .utils.request_work import request_work


class _ResponseTooLargeError(Exception):
    """Internal signal: bypass HTTPException handlers after response.start."""


class ProductionLimitsMiddleware:
    def __init__(self, app: ASGIApp, profile: ProductionProfile) -> None:
        self.app = app
        self.profile = profile
        self.gate = ProductionGate(profile)

    @property
    def active(self) -> int:
        """Requests holding an admission slot, their draining work included."""

        return self.gate.active

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if not self.gate.admit():
            await error_response(Request(scope), at_capacity())(scope, receive, send)
            return
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
                work.cancel()
                if committed:
                    # The transport must close a stalled partial response.
                    # A second status line would corrupt the HTTP connection.
                    raise
                await error_response(Request(scope), timed_out())(scope, receive, send)
            except _ResponseTooLargeError:
                await error_response(Request(scope), too_large())(scope, receive, send)
            except Exception as exc:
                if committed:
                    raise
                request = Request(scope)
                await error_response(request, as_serve_error(exc, request=request))(
                    scope, receive, send
                )
        finally:
            # A 504 releases the HTTP caller, but still-running host code
            # keeps its admission slot until its threads have stopped.
            self.gate.release(work)
