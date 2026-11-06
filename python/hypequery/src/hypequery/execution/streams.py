"""Executor-side streams: one open query handed over batch by batch.

A stream keeps, for the whole of its life, the rules ``execute`` applies to one
call: a cancelled or expired caller stops it between batches, and on the server
where the engine can stop a query; a driver failure is reported without the
driver's text; and the admission it holds (an executor slot, chDB's
connection) is released exactly once, when it closes.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import suppress
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

from .cancellation import KillRetries, run_with_policy, terminal_error
from .utils.arrow_ipc import ArrowIpcDecoder

if TYPE_CHECKING:
    import pyarrow as pa

_T = TypeVar("_T")
_LOGGER = logging.getLogger(__name__)

#: How much of a raw Arrow body one read hands to the decoder.
ARROW_CHUNK_BYTES = 1 << 20

Fail = Callable[[Exception], CompiledQueryError]


class SyncBatchStream(Generic[_T]):
    """A blocking executor's open stream."""

    def __init__(
        self,
        compiled: CompiledQuery,
        batches: Iterator[_T],
        *,
        release: Callable[[], None],
        fail: Fail,
        abandon: Callable[[], object] | None = None,
        columns: tuple[str, ...] = (),
        schema: pa.Schema | None = None,
    ) -> None:
        self._compiled = compiled
        self._batches = batches
        self._release = release
        self._fail = fail
        self._abandon = abandon
        self._columns = columns
        self._schema = schema
        self._finished = False
        self._closed = False

    @property
    def columns(self) -> tuple[str, ...]:
        return self._columns

    @property
    def schema(self) -> pa.Schema:
        if self._schema is None:
            raise AttributeError("a row stream has no Arrow schema")
        return self._schema

    def __iter__(self) -> Iterator[_T]:
        return self

    def __next__(self) -> _T:
        if self._closed:
            raise StopIteration
        reason = terminal_error(self._compiled)
        if reason is not None:
            self.close()
            raise reason
        try:
            return next(self._batches)
        except StopIteration:
            self._finished = True
            self.close()
            raise
        except Exception as exc:
            self.close()
            # A cancelled or expired query fails because the caller stopped it.
            stopped = terminal_error(self._compiled)
            if stopped is not None:
                raise stopped from None
            if isinstance(exc, CompiledQueryError):
                raise
            raise self._fail(exc) from None

    def close(self) -> None:
        """Release the stream; one closed before its end stops the query on the server."""

        if self._closed:
            return
        self._closed = True
        try:
            self._release()
        finally:
            if not self._finished and self._abandon is not None:
                try:
                    self._abandon()
                except Exception:
                    _LOGGER.warning(
                        "Server cancellation failed for query %s", self._compiled.query_id
                    )


class AsyncBatchStream(Generic[_T]):
    """A native async executor's open stream; each batch waits under the cancellation policy."""

    def __init__(
        self,
        compiled: CompiledQuery,
        batches: AsyncIterator[_T],
        *,
        release: Callable[[], Awaitable[None]],
        fail: Fail,
        cancel_on_server: Callable[[str], Awaitable[object]] | None,
        retries: KillRetries | None = None,
        columns: tuple[str, ...] = (),
        schema: pa.Schema | None = None,
    ) -> None:
        self._compiled = compiled
        self._batches = batches
        self._release = release
        self._fail = fail
        self._cancel_on_server = cancel_on_server
        self._retries = retries
        self._columns = columns
        self._schema = schema
        self._finished = False
        self._closed = False

    @property
    def columns(self) -> tuple[str, ...]:
        return self._columns

    @property
    def schema(self) -> pa.Schema:
        if self._schema is None:
            raise AttributeError("a row stream has no Arrow schema")
        return self._schema

    def __aiter__(self) -> AsyncIterator[_T]:
        return self

    async def _step(self) -> tuple[bool, _T | None]:
        try:
            return True, await self._batches.__anext__()
        except StopAsyncIteration:
            return False, None

    async def __anext__(self) -> _T:
        if self._closed:
            raise StopAsyncIteration
        try:
            has_batch, batch = await run_with_policy(
                self._step(), self._compiled, self._cancel_on_server, retries=self._retries
            )
        except CompiledQueryError:
            await self.aclose()
            raise
        except Exception as exc:
            await self.aclose()
            raise self._fail(exc) from None
        if not has_batch:
            self._finished = True
            await self.aclose()
            raise StopAsyncIteration
        return batch  # type: ignore[return-value]

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            await self._release()
        finally:
            if not self._finished and self._cancel_on_server is not None:
                with suppress(Exception):
                    await self._cancel_on_server(self._compiled.query_id)


def _retrieve_outcome(done: asyncio.Future[Any]) -> None:
    # A caller that gave up never reads the worker's outcome; mark it retrieved.
    if not done.cancelled():
        done.exception()


class ThreadedBatchStream(Generic[_T]):
    """A blocking stream driven from the event loop, one worker call per batch.

    A batch the caller stops waiting for (cancellation, deadline) keeps its
    worker until the driver returns, as a buffered query does; the executor
    slot is released only once the stream's close has run on the worker.
    """

    def __init__(
        self,
        compiled: CompiledQuery,
        sync: SyncBatchStream[_T],
        worker: ThreadPoolExecutor,
        *,
        release_slot: Callable[[], None],
        cancel_on_server: Callable[[str], Awaitable[object]] | None,
        retries: KillRetries | None = None,
    ) -> None:
        self._compiled = compiled
        self._sync = sync
        self._worker = worker
        self._release_slot = release_slot
        self._cancel_on_server = cancel_on_server
        self._retries = retries
        self._finished = False
        self._closed = False

    @property
    def columns(self) -> tuple[str, ...]:
        return self._sync.columns

    @property
    def schema(self) -> pa.Schema:
        return self._sync.schema

    def __aiter__(self) -> AsyncIterator[_T]:
        return self

    def _next(self) -> tuple[bool, _T | None]:
        try:
            return True, next(self._sync)
        except StopIteration:
            return False, None

    async def __anext__(self) -> _T:
        if self._closed:
            raise StopAsyncIteration
        future: Future[tuple[bool, _T | None]] = self._worker.submit(self._next)
        work = asyncio.wrap_future(future)
        work.add_done_callback(_retrieve_outcome)
        try:
            has_batch, batch = await run_with_policy(
                work,
                self._compiled,
                self._cancel_on_server,
                pending=lambda: not future.done(),
                retries=self._retries,
            )
        except BaseException:
            await self.aclose()
            raise
        if not has_batch:
            self._finished = True
            await self.aclose()
            raise StopAsyncIteration
        return batch  # type: ignore[return-value]

    async def aclose(self) -> None:
        """Close on the worker; the slot frees once the driver has let go.

        A stream closed before its end also asks the server to stop the query:
        closing the response alone stops it only when ClickHouse next writes.
        """

        if self._closed:
            return
        self._closed = True
        if not self._finished and self._cancel_on_server is not None:
            with suppress(Exception):
                await self._cancel_on_server(self._compiled.query_id)
        try:
            future = self._worker.submit(self._sync.close)
        except RuntimeError:
            # The worker pool shut down with its executor.
            self._release_slot()
            return
        future.add_done_callback(lambda _: self._release_slot())


async def open_threaded(
    compiled: CompiledQuery,
    worker: ThreadPoolExecutor,
    open_sync: Callable[[], SyncBatchStream[_T]],
    *,
    release_slot: Callable[[], None],
    cancel_on_server: Callable[[str], Awaitable[object]] | None,
    retries: KillRetries | None = None,
) -> ThreadedBatchStream[_T]:
    """Open a blocking stream on *worker*; the caller already holds the slot."""

    future = worker.submit(open_sync)
    work = asyncio.wrap_future(future)
    work.add_done_callback(_retrieve_outcome)

    def abandon_late_open(done: Future[SyncBatchStream[_T]]) -> None:
        # The caller stopped waiting; a stream that opened anyway is closed here.
        if not done.cancelled() and done.exception() is None:
            done.result().close()
        release_slot()

    try:
        sync = await run_with_policy(
            work, compiled, cancel_on_server, pending=lambda: not future.done(), retries=retries
        )
    except BaseException:
        if future.done():
            if not future.cancelled() and future.exception() is None:
                future.result().close()
            release_slot()
        else:
            future.add_done_callback(abandon_late_open)
        raise
    return ThreadedBatchStream(
        compiled,
        sync,
        worker,
        release_slot=release_slot,
        cancel_on_server=cancel_on_server,
        retries=retries,
    )


def arrow_batches(decoder: ArrowIpcDecoder, chunks: Iterator[bytes]) -> Iterator[pa.RecordBatch]:
    """Decoded batches of a raw Arrow body, ClickHouse's error if it reported one."""

    try:
        for chunk in chunks:
            yield from decoder.feed(chunk)
    except Exception:
        failure = decoder.failed()
        if failure is not None:
            raise failure from None
        raise
    yield from decoder.finish()


async def async_arrow_batches(
    decoder: ArrowIpcDecoder, chunks: AsyncIterator[bytes]
) -> AsyncIterator[pa.RecordBatch]:
    try:
        async for chunk in chunks:
            for batch in decoder.feed(chunk):
                yield batch
    except Exception:
        failure = decoder.failed()
        if failure is not None:
            raise failure from None
        raise
    for batch in decoder.finish():
        yield batch


def peek(batches: Iterator[_T]) -> Iterator[_T]:
    """*batches* with the first one already read, so a header decoded before it is known."""

    first = next(batches, _END)
    if first is _END:
        return iter(())

    def chained() -> Iterator[_T]:
        yield first
        yield from batches

    return chained()


async def apeek(batches: AsyncIterator[_T]) -> AsyncIterator[_T]:
    first = await anext(batches, _END)

    async def chained() -> AsyncIterator[_T]:
        if first is _END:
            return
        yield first
        async for batch in batches:
            yield batch

    return chained()


_END: Any = object()
