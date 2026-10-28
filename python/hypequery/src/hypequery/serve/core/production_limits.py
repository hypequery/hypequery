"""A production profile's process budgets: admission, request duration, response bytes.

`ProductionGate` owns admission. A request takes a slot when it starts and keeps
it until the work it started has finished, so a 504 that releases the caller
does not free capacity while host code is still running on a worker thread.
`Api.handle` serves through `ProductionGate.run`; an adapter that has to bound
a whole application, routes the core does not serve included, uses `admit` and
`release` around its own buffering.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .errors import ServeHttpError, error_response, serve_error
from .messages import ServeResponse
from .production import ProductionProfile
from .state import RequestState
from .work import RequestWork

AT_CAPACITY = "The server is at capacity."
TIMED_OUT = "The query did not finish in time."
TOO_LARGE = "The response exceeds its byte limit."


def at_capacity() -> ServeHttpError:
    return serve_error(503, "SERVICE_UNAVAILABLE", AT_CAPACITY)


def timed_out() -> ServeHttpError:
    return serve_error(504, "GATEWAY_TIMEOUT", TIMED_OUT)


def too_large() -> ServeHttpError:
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
        self, state: RequestState, serve: Callable[[], Awaitable[ServeResponse]]
    ) -> ServeResponse:
        """Serve one request within the profile's budgets.

        Over capacity is `503`; over the deadline is `504`, with the request's
        work cancelled; a body over the byte ceiling is `413`, so no oversized
        response ever reaches the wire.
        """

        if not self.admit():
            return error_response(at_capacity(), state.request_id)
        try:
            try:
                async with asyncio.timeout(self.profile.timeout_seconds):
                    response = await serve()
            except TimeoutError:
                state.work.cancel()
                return error_response(timed_out(), state.request_id)
            if len(response.body) > self.profile.max_result_bytes:
                return error_response(too_large(), state.request_id)
            return response
        finally:
            self.release(state.work)
