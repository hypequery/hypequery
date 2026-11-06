"""A dataset client's stream as async batches, whichever client the endpoint holds."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Callable
from typing import Any

from ...datasets.client import AsyncDatasetClient, DatasetClient
from ..core.work import RequestWork, run_sync

_END: Any = object()


async def client_batches(
    work: RequestWork,
    client: DatasetClient | AsyncDatasetClient,
    open_stream: Callable[[DatasetClient | AsyncDatasetClient], Any],
) -> AsyncGenerator[Any, None]:
    """The batches of ``open_stream(client)``, opened and closed with the generator.

    An async client's stream is driven on the loop; a sync client's on the
    request's worker threads, tracked by *work* like a buffered query. The
    first batch read opens the query, so a failure to start surfaces there.
    """

    if isinstance(client, AsyncDatasetClient):
        async with open_stream(client) as stream:
            yield stream
            async for batch in stream:
                yield batch
        return
    stream = await run_sync(work, open_stream, client)
    # The worker call in flight, if any. A cancelled caller stops waiting for
    # it, but the stream may only close once it has returned: closing while it
    # still runs could miss the response it is about to open.
    pending: asyncio.Task[Any] | None = None

    async def call(function: Callable[..., Any], *args: Any) -> Any:
        nonlocal pending
        pending = work.start_sync(function, *args)
        return await asyncio.shield(pending)

    try:
        await call(stream.__enter__)
        yield stream
        batches = iter(stream)
        while (batch := await call(next, batches, _END)) is not _END:
            yield batch
    finally:
        closing = asyncio.ensure_future(_close_after(work, stream, pending))
        _CLOSING.add(closing)
        closing.add_done_callback(_CLOSING.discard)
        await asyncio.shield(closing)


#: Closes still running, kept referenced until they finish.
_CLOSING: set[asyncio.Task[None]] = set()


async def _close_after(work: RequestWork, stream: Any, pending: asyncio.Task[Any] | None) -> None:
    """Close *stream* once *pending* has returned, whatever it returned.

    A cancelled request's work starts no new task but cleanup, and a stream
    must always close: it holds a response, or chDB's connection.
    """

    if pending is not None and not pending.done():
        await asyncio.wait((pending,))
    closing = work.start_cleanup(stream.close)
    await (closing if closing is not None else asyncio.to_thread(stream.close))
