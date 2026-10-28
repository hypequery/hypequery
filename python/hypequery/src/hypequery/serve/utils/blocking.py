"""Serve one request from a sync host: a WSGI server, or a framework's sync view.

The request's coroutine runs on the process's serving loop (`serving_loop.py`)
while the calling thread waits, reading the body for it when asked. Every sync
adapter builds its `ServeRequest` through *build*, which receives the waiting
thread so the body can be read there (`thread_body`).
"""

from __future__ import annotations

from collections.abc import Callable

from ..core.api import Api
from ..core.messages import ServeRequest, ServeResponse
from .fault import answer
from .serving_loop import RequestThread, serving_loop


def serve_blocking(
    api: Api,
    build: Callable[[RequestThread], ServeRequest],
    *,
    mounted_at: str | None = None,
) -> ServeResponse:
    """The answer to the request `build(thread)` describes, served on the loop."""

    async def serve(thread: RequestThread) -> ServeResponse:
        return await answer(api, build(thread), mounted_at=mounted_at)

    return serving_loop().run(serve)
