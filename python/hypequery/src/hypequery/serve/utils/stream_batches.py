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
    try:
        await run_sync(work, stream.__enter__)
        yield stream
        batches = iter(stream)
        while (batch := await run_sync(work, next, batches, _END)) is not _END:
            yield batch
    finally:
        # A cancelled request's work starts no new task but cleanup, and a
        # stream must always close: it holds a response, or chDB's connection.
        closing = work.start_cleanup(stream.close)
        await asyncio.shield(closing if closing is not None else asyncio.to_thread(stream.close))
