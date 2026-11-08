"""Streamed dataset results: rows in batches, or Arrow record batches.

A stream runs exactly the query ``execute`` would, planned and admitted the
same way, but hands the result over as the executor receives it, so memory
stays flat however many rows there are. Streams never read or fill the result
cache and report no pagination. Use one as a context manager: closing it before
the end stops the query.

The executor protocols here are what a streaming executor implements; the
built-in ClickHouse and chDB executors do.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from types import TracebackType
from typing import TYPE_CHECKING, Protocol, Self

from ..planner import CompiledQuery
from ..utils.output_column_types import ResultColumnType
from .results import ResultRows, ResultScalar

if TYPE_CHECKING:
    import pyarrow as pa

#: One batch of a row stream: the rows ``execute`` would return, in order.
RowBatch = tuple[dict[str, ResultScalar], ...]


class RowBatchStream(Protocol):
    """An executor's open row stream."""

    @property
    def columns(self) -> tuple[str, ...]: ...

    def __iter__(self) -> Iterator[ResultRows]: ...

    def close(self) -> None: ...


class AsyncRowBatchStream(Protocol):
    @property
    def columns(self) -> tuple[str, ...]: ...

    def __aiter__(self) -> AsyncIterator[ResultRows]: ...

    async def aclose(self) -> None: ...


class ArrowBatchStream(Protocol):
    """An executor's open Arrow stream."""

    @property
    def schema(self) -> pa.Schema: ...

    def __iter__(self) -> Iterator[pa.RecordBatch]: ...

    def close(self) -> None: ...


class AsyncArrowBatchStream(Protocol):
    @property
    def schema(self) -> pa.Schema: ...

    def __aiter__(self) -> AsyncIterator[pa.RecordBatch]: ...

    async def aclose(self) -> None: ...


class StreamingQueryExecutor(Protocol):
    """A synchronous executor that can also stream a compiled query."""

    def stream(self, compiled: CompiledQuery) -> RowBatchStream: ...

    def stream_arrow(self, compiled: CompiledQuery) -> ArrowBatchStream: ...


class AsyncStreamingQueryExecutor(Protocol):
    async def stream(self, compiled: CompiledQuery) -> AsyncRowBatchStream: ...

    async def stream_arrow(self, compiled: CompiledQuery) -> AsyncArrowBatchStream: ...


@dataclass(frozen=True, slots=True)
class StreamShape:
    """What a stream's caller knows before the first batch arrives."""

    query_id: str
    columns: tuple[str, ...]
    column_types: tuple[ResultColumnType, ...]
    timezone: str


def _keyed(columns: tuple[str, ...], batch: ResultRows) -> RowBatch:
    names = tuple(batch.columns) or columns
    return tuple(dict(zip(names, row, strict=True)) for row in batch.rows)


class _StreamBase:
    __slots__ = ("_shape",)

    def __init__(self, shape: StreamShape) -> None:
        self._shape = shape

    @property
    def query_id(self) -> str:
        return self._shape.query_id

    @property
    def timezone(self) -> str:
        """The query's timezone, which timestamp values are rendered for."""
        return self._shape.timezone


class _RowStreamBase(_StreamBase):
    __slots__ = ()

    @property
    def columns(self) -> tuple[str, ...]:
        return self._shape.columns

    @property
    def column_types(self) -> tuple[ResultColumnType, ...]:
        """Each column's result type, as on ``DatasetQueryResult``."""
        return self._shape.column_types


class DatasetRowStream(_RowStreamBase):
    """A dataset query's rows, in batches as they arrive.

    The query starts on entering the ``with`` block (or on the first
    iteration) and stops when it is closed::

        with client.stream(orders, query) as stream:
            for batch in stream:
                for row in batch:
                    ...
    """

    __slots__ = ("_closed", "_open", "_source")

    def __init__(self, open_stream: Callable[[], RowBatchStream], shape: StreamShape) -> None:
        super().__init__(shape)
        self._open = open_stream
        self._source: RowBatchStream | None = None
        self._closed = False

    def _opened(self) -> RowBatchStream:
        if self._closed:
            raise RuntimeError("the stream is closed")
        if self._source is None:
            self._source = self._open()
        return self._source

    def __enter__(self) -> Self:
        self._opened()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def __iter__(self) -> Iterator[RowBatch]:
        source = self._opened()
        try:
            for batch in source:
                yield _keyed(self.columns, batch)
        finally:
            self.close()

    def rows(self) -> Iterator[dict[str, ResultScalar]]:
        """The rows one at a time, across batches."""

        for batch in self:
            yield from batch

    def close(self) -> None:
        """Stop the query if it is still running; closing twice is a no-op."""

        self._closed = True
        source, self._source = self._source, None
        if source is not None:
            source.close()


class AsyncDatasetRowStream(_RowStreamBase):
    """The async twin of :class:`DatasetRowStream`::

    async with client.stream(orders, query) as stream:
        async for batch in stream:
            ...
    """

    __slots__ = ("_closed", "_open", "_source")

    def __init__(
        self, open_stream: Callable[[], Awaitable[AsyncRowBatchStream]], shape: StreamShape
    ) -> None:
        super().__init__(shape)
        self._open = open_stream
        self._source: AsyncRowBatchStream | None = None
        self._closed = False

    async def _opened(self) -> AsyncRowBatchStream:
        if self._closed:
            raise RuntimeError("the stream is closed")
        if self._source is None:
            self._source = await self._open()
        return self._source

    async def __aenter__(self) -> Self:
        await self._opened()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def __aiter__(self) -> AsyncIterator[RowBatch]:
        source = await self._opened()
        try:
            async for batch in source:
                yield _keyed(self.columns, batch)
        finally:
            await self.aclose()

    async def rows(self) -> AsyncIterator[dict[str, ResultScalar]]:
        """The rows one at a time, across batches."""

        async for batch in self:
            for row in batch:
                yield row

    async def aclose(self) -> None:
        self._closed = True
        source, self._source = self._source, None
        if source is not None:
            await source.aclose()


class DatasetArrowStream(_StreamBase):
    """A dataset query's result as Arrow record batches with ClickHouse's native types.

    Measures keep their database types: a ``Decimal`` column is ``decimal128``
    and a count ``uint64``, unlike the JSON-safe values of a row stream.
    Requires ``hypequery[arrow]``::

        with client.stream_arrow(orders, query) as stream:
            table = stream.read_all()
    """

    __slots__ = ("_closed", "_open", "_source")

    def __init__(self, open_stream: Callable[[], ArrowBatchStream], shape: StreamShape) -> None:
        super().__init__(shape)
        self._open = open_stream
        self._source: ArrowBatchStream | None = None
        self._closed = False

    def _opened(self) -> ArrowBatchStream:
        if self._closed:
            raise RuntimeError("the stream is closed")
        if self._source is None:
            self._source = self._open()
        return self._source

    @property
    def schema(self) -> pa.Schema:
        """The result's Arrow schema; reading it starts the query."""
        return self._opened().schema

    def __enter__(self) -> Self:
        self._opened()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def __iter__(self) -> Iterator[pa.RecordBatch]:
        source = self._opened()
        try:
            yield from source
        finally:
            self.close()

    def to_reader(self) -> pa.RecordBatchReader:
        """A ``pyarrow.RecordBatchReader`` over the batches, for DuckDB, polars or pandas."""

        import pyarrow as pa

        return pa.RecordBatchReader.from_batches(self.schema, iter(self))

    def read_all(self) -> pa.Table:
        """Every remaining batch as one ``pyarrow.Table``."""

        import pyarrow as pa

        schema = self.schema
        return pa.Table.from_batches(list(self), schema=schema)

    def close(self) -> None:
        self._closed = True
        source, self._source = self._source, None
        if source is not None:
            source.close()


class AsyncDatasetArrowStream(_StreamBase):
    """The async twin of :class:`DatasetArrowStream`; ``schema`` is known once entered."""

    __slots__ = ("_closed", "_open", "_source")

    def __init__(
        self, open_stream: Callable[[], Awaitable[AsyncArrowBatchStream]], shape: StreamShape
    ) -> None:
        super().__init__(shape)
        self._open = open_stream
        self._source: AsyncArrowBatchStream | None = None
        self._closed = False

    async def _opened(self) -> AsyncArrowBatchStream:
        if self._closed:
            raise RuntimeError("the stream is closed")
        if self._source is None:
            self._source = await self._open()
        return self._source

    @property
    def schema(self) -> pa.Schema:
        if self._source is None:
            raise RuntimeError("enter the stream before reading its schema")
        return self._source.schema

    async def __aenter__(self) -> Self:
        await self._opened()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def __aiter__(self) -> AsyncIterator[pa.RecordBatch]:
        source = await self._opened()
        try:
            async for batch in source:
                yield batch
        finally:
            await self.aclose()

    async def read_all(self) -> pa.Table:
        import pyarrow as pa

        source = await self._opened()
        batches = [batch async for batch in self]
        return pa.Table.from_batches(batches, schema=source.schema)

    async def aclose(self) -> None:
        self._closed = True
        source, self._source = self._source, None
        if source is not None:
            await source.aclose()
