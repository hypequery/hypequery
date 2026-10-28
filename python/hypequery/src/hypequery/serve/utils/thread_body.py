"""A request body read on the request's own thread, as the core asks for it.

A sync server's request body is a blocking stream (`wsgi.input`, or a
framework's wrapper around it). The core reads bodies as async chunks, on the
serving loop, which must never block on a socket; each chunk is read by the
request's waiting thread instead (`RequestThread.call`). Nothing is read until
the core asks, which is only for a route that takes input, after
authentication, and the core stops asking once the body passes its limit.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from functools import partial

from .asgi_body import ClientDisconnectedError
from .serving_loop import RequestThread

#: Bytes asked of the stream at a time.
CHUNK_BYTES = 65_536


async def thread_body(
    thread: RequestThread, read: Callable[[int], bytes], length: int | None
) -> AsyncIterator[bytes]:
    """The body's chunks from `read(size)`: *length* bytes, or until it returns none.

    A stream that ends before *length* bytes means the caller went away
    mid-body.
    """

    remaining = length
    while remaining is None or remaining > 0:
        size = CHUNK_BYTES if remaining is None else min(CHUNK_BYTES, remaining)
        chunk = await thread.call(partial(read, size))
        if not chunk:
            if remaining is not None:
                raise ClientDisconnectedError
            return
        if remaining is not None:
            remaining -= len(chunk)
        yield chunk
