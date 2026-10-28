"""A production profile's process budgets: admission, request duration, response bytes.

`ProductionGate` owns admission. A request takes a slot when it starts and keeps
it until its answer has been written and the work it started has finished, so
neither a 504 that releases the caller nor a caller that will not read its
answer frees capacity while host code or the write is still running.
`Api.serve` runs every request through `ProductionGate.run`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .errors import ServeError, error_response, serve_error
from .messages import ServeResponse
from .production import ProductionProfile
from .state import RequestState
from .work import RequestWork

AT_CAPACITY = "The server is at capacity."
TIMED_OUT = "The query did not finish in time."
TOO_LARGE = "The response exceeds its byte limit."


def at_capacity() -> ServeError:
    return serve_error(503, "SERVICE_UNAVAILABLE", AT_CAPACITY)


def timed_out() -> ServeError:
    return serve_error(504, "GATEWAY_TIMEOUT", TIMED_OUT)


def too_large() -> ServeError:
    return serve_error(413, "PAYLOAD_TOO_LARGE", TOO_LARGE)


class ProductionGate:
    """Admission and budgets for one profile, shared by every request it serves."""

    __slots__ = ("_draining", "active", "profile")

    def __init__(self, profile: ProductionProfile) -> None:
        if type(profile) is not ProductionProfile:
            raise TypeError("a ProductionGate requires a ProductionProfile")
        self.profile = profile
        self.active = 0
        self._draining: set[asyncio.Task[None]] = set()

    def admit(self) -> bool:
        """Take a slot, or refuse when every slot is taken.

        There is no await between the check and the increment, so admission is
        atomic on the event loop.
        """

        if self.active >= self.profile.max_concurrency:
            return False
        self.active += 1
        return True

    def release(self, work: RequestWork) -> None:
        """Give the slot back once *work*'s threads have stopped."""

        work.cancel()
        if work.tasks:
            draining = asyncio.create_task(self._release_after(work))
            self._draining.add(draining)
            draining.add_done_callback(self._draining.discard)
        else:
            self.active -= 1

    async def _release_after(self, work: RequestWork) -> None:
        try:
            await work.drain()
        finally:
            self.active -= 1

    async def run(
        self,
        state: RequestState,
        serve: Callable[[], Awaitable[ServeResponse]],
        respond: Callable[[ServeResponse], Awaitable[None]],
    ) -> None:
        """Serve one request within the profile's budgets, answering through *respond*.

        Over capacity is `503`; over the deadline is `504`, with the request's
        work cancelled; a body over the byte ceiling is `413`, so no oversized
        response ever reaches the wire. The slot is held, and the deadline
        runs, until *respond* has finished. A deadline that passes while
        *respond* is writing raises `TimeoutError`: a second status line
        would corrupt the connection, so the transport must close it.
        """

        if not self.admit():
            await respond(error_response(at_capacity(), state.request_id))
            return
        committed = False
        try:
            try:
                async with asyncio.timeout(self.profile.timeout_seconds):
                    response = await serve()
                    if len(response.body) > self.profile.max_result_bytes:
                        response = error_response(too_large(), state.request_id)
                    committed = True
                    await respond(response)
            except TimeoutError:
                state.work.cancel()
                if committed:
                    raise
                await respond(error_response(timed_out(), state.request_id))
        finally:
            # A 504 releases the caller, but still-running host code keeps
            # its admission slot until its threads have stopped.
            self.release(state.work)
