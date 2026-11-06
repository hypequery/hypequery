"""Streamed results: the decoders, every executor against a fake driver, and the clients.

Live behaviour (real ClickHouse, real chDB) is in ``test_streaming_live.py``.
"""

from __future__ import annotations

import asyncio
import io
import random
import threading
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import pyarrow as pa
import pytest
from clickhouse_connect.driver.exceptions import StreamFailureError

from hypequery.datasets import (
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    measure,
    tenant,
)
from hypequery.datasets.aggregations import count
from hypequery.datasets.aggregations import sum as sum_
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.planner import TypedParameter
from hypequery.execution import (
    AsyncClickHouseExecutor,
    AsyncFromSyncClickHouseExecutor,
    ClickHouseExecutor,
)
from hypequery.execution.utils.arrow_ipc import ArrowIpcDecoder
from hypequery.execution.utils.json_compact import decode_json_compact_each_row
from hypequery.execution.utils.stream_exception import (
    EXCEPTION_BLOCK_MAX_BYTES,
    split_stream_exception,
)

TAG = "abcdefghijklmnop"
TOO_MANY = (
    "Code: 396. DB::Exception: Limit for result exceeded, max rows: 100.00 thousand. "
    "(TOO_MANY_ROWS_OR_BYTES) (version 26.6.2.20 (official build))"
)


def exception_block(message: str = TOO_MANY, tag: str = TAG) -> bytes:
    return (
        f"\r\n__exception__\r\n{tag}\r\n{message}\n{len(message) + 1} {tag}\r\n__exception__\r\n"
    ).encode()


def arrow_body(batches: list[pa.RecordBatch], compression: str | None = None) -> bytes:
    sink = io.BytesIO()
    options = pa.ipc.IpcWriteOptions(compression=compression)
    with pa.ipc.new_stream(sink, batches[0].schema, options=options) as writer:
        for batch in batches:
            writer.write_batch(batch)
    return sink.getvalue()


def sample_batches(count_: int = 4, rows: int = 5000) -> list[pa.RecordBatch]:
    out = []
    for index in range(count_):
        start = index * rows
        out.append(
            pa.record_batch(
                {
                    "n": pa.array(range(start, start + rows), pa.uint64()),
                    "s": pa.array([str(value) for value in range(start, start + rows)]),
                    "d": pa.array(
                        [Decimal(value) / 100 for value in range(start, start + rows)],
                        pa.decimal128(18, 2),
                    ),
                }
            )
        )
    return out


def chunked(data: bytes, seed: int = 7) -> Iterator[bytes]:
    rng = random.Random(seed)  # noqa: S311 - reproducible chunk sizes, not security
    at = 0
    while at < len(data):
        size = rng.randint(1, 70_000)
        yield data[at : at + size]
        at += size


# --- the exception block ---------------------------------------------------


def test_split_finds_the_block_and_the_data_before_it() -> None:
    failure = split_stream_exception(b"data" + exception_block(), TAG)
    assert failure is not None
    assert failure.data == b"data"
    assert failure.message == TOO_MANY


def test_split_learns_the_tag_from_the_block_itself() -> None:
    failure = split_stream_exception(b"data" + exception_block())
    assert failure is not None
    assert failure.message == TOO_MANY


def test_split_ignores_a_body_that_merely_contains_the_marker() -> None:
    assert split_stream_exception(exception_block() + b"more data", TAG) is None
    assert split_stream_exception(b"rows", TAG) is None
    assert split_stream_exception(b"data" + exception_block(tag="zzzzzzzzzzzzzzzz"), TAG) is None


# --- incremental Arrow decoding -------------------------------------------


@pytest.mark.parametrize("compression", [None, "lz4", "zstd"])
def test_the_decoder_rebuilds_every_batch_from_arbitrary_chunks(compression: str | None) -> None:
    batches = sample_batches()
    decoder = ArrowIpcDecoder("q")
    decoded: list[pa.RecordBatch] = []
    for chunk in chunked(arrow_body(batches, compression)):
        decoded.extend(decoder.feed(chunk))
    decoded.extend(decoder.finish())

    assert decoder.schema == batches[0].schema
    assert pa.Table.from_batches(decoded).equals(pa.Table.from_batches(batches))


def test_the_decoder_reports_clickhouses_error_after_partial_data() -> None:
    body = arrow_body(sample_batches())[:-200] + exception_block()
    decoder = ArrowIpcDecoder("q", TAG)
    for chunk in chunked(body):
        decoder.feed(chunk)

    with pytest.raises(CompiledQueryError) as raised:
        decoder.finish()
    assert raised.value.category == "too-large"
    assert "Limit" not in raised.value.message


def test_the_decoder_finds_the_block_when_the_transport_fails_after_it() -> None:
    decoder = ArrowIpcDecoder("q")
    for chunk in chunked(arrow_body(sample_batches())[:-50] + exception_block()):
        decoder.feed(chunk)
    failure = decoder.failed()
    assert failure is not None
    assert failure.category == "too-large"


def test_an_older_servers_plain_message_is_still_clickhouses_error() -> None:
    # Before 25.11 a failed body simply ends with the message text.
    body = arrow_body(sample_batches())[:-300] + b"\n" + TOO_MANY.encode() + b"\n"
    decoder = ArrowIpcDecoder("q")
    for chunk in chunked(body):
        decoder.feed(chunk)
    with pytest.raises(CompiledQueryError) as raised:
        decoder.finish()
    assert raised.value.category == "too-large"

    decoder = ArrowIpcDecoder("q")
    for chunk in chunked(body):
        decoder.feed(chunk)
    failure = decoder.failed()
    assert failure is not None
    assert failure.category == "too-large"


def test_a_truncated_body_is_an_internal_error() -> None:
    decoder = ArrowIpcDecoder("q")
    for chunk in chunked(arrow_body(sample_batches())[:-500]):
        decoder.feed(chunk)
    assert decoder.failed() is None
    with pytest.raises(CompiledQueryError) as raised:
        decoder.finish()
    assert raised.value.category == "internal"


def test_the_decoder_holds_the_tail_until_the_body_ends() -> None:
    body = arrow_body(sample_batches(1, 10))
    decoder = ArrowIpcDecoder("q")
    assert decoder.feed(body) == []  # smaller than the held tail
    assert sum(batch.num_rows for batch in decoder.finish()) == 10
    assert len(body) < EXCEPTION_BLOCK_MAX_BYTES


# --- chDB's streamed JSON chunks -------------------------------------------


def test_a_chdb_chunk_decodes_with_its_own_header() -> None:
    payload = (
        b'["n", "d", "s"]\n["UInt64", "Nullable(Decimal(18, 2))", "String"]\n'
        b'[1, "0.50", "a"]\n[2, null, "b"]\n'
    )
    result = decode_json_compact_each_row(payload, "q")
    assert result.column_names == ("n", "d", "s")
    assert result.result_rows == [(1, Decimal("0.50"), "a"), (2, None, "b")]


@pytest.mark.parametrize("payload", [b"", b'["n"]\n', b'["n"]\n["UInt64"]\n[1, 2]\n', b"\xff"])
def test_a_malformed_chdb_chunk_is_an_internal_error(payload: bytes) -> None:
    with pytest.raises(CompiledQueryError) as raised:
        decode_json_compact_each_row(payload, "q")
    assert raised.value.category == "internal"


# --- fake drivers ------------------------------------------------------------


class _Source:
    def __init__(self, column_names: tuple[str, ...]) -> None:
        self.column_names = column_names


class FakeRowContext:
    """clickhouse-connect's StreamContext over row blocks."""

    def __init__(self, columns: tuple[str, ...], blocks: list[Any]) -> None:
        self.source = _Source(columns)
        self._blocks = blocks
        self.entered = False
        self.exited = False

    def __enter__(self) -> FakeRowContext:
        self.entered = True
        return self

    def __exit__(self, *_: object) -> None:
        self.exited = True

    def __iter__(self) -> Iterator[Any]:
        for block in self._blocks:
            if isinstance(block, Exception):
                raise block
            yield block

    async def __aenter__(self) -> FakeRowContext:
        return self.__enter__()

    async def __aexit__(self, *_: object) -> None:
        self.__exit__()

    async def __aiter__(self) -> AsyncIterator[Any]:
        for block in self:
            await asyncio.sleep(0)
            yield block


class FakeResponse:
    """urllib3's HTTPResponse for a raw ArrowStream body."""

    def __init__(self, body: bytes, error: Exception | None = None, tag: str | None = TAG) -> None:
        self.headers = {} if tag is None else {"X-ClickHouse-Exception-Tag": tag}
        self._body = body
        self._error = error
        self.closed = False

    def stream(self, amount: int) -> Iterator[bytes]:
        yield from chunked(self._body)
        if self._error is not None:
            raise self._error

    def close(self) -> None:
        self.closed = True


class FakeAsyncRawContext:
    def __init__(self, body: bytes, error: Exception | None = None) -> None:
        self._body = body
        self._error = error
        self.exited = False

    async def __aenter__(self) -> FakeAsyncRawContext:
        return self

    async def __aexit__(self, *_: object) -> None:
        self.exited = True

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in chunked(self._body):
            await asyncio.sleep(0)
            yield chunk
        if self._error is not None:
            raise self._error


@dataclass
class FakeClient:
    rows: FakeRowContext | None = None
    response: FakeResponse | None = None
    calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = field(default_factory=list)

    def query_row_block_stream(self, *args: Any, **kwargs: Any) -> FakeRowContext:
        self.calls.append(("rows", args, kwargs))
        assert self.rows is not None
        return self.rows

    def raw_stream(self, *args: Any, **kwargs: Any) -> FakeResponse:
        self.calls.append(("raw", args, kwargs))
        assert self.response is not None
        return self.response

    def query(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append(("query", args, kwargs))
        raise AssertionError("a stream must not run a buffered query")


@dataclass
class FakeAsyncClient:
    rows: FakeRowContext | None = None
    raw: FakeAsyncRawContext | None = None
    calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = field(default_factory=list)

    async def query_row_block_stream(self, *args: Any, **kwargs: Any) -> FakeRowContext:
        self.calls.append(("rows", args, kwargs))
        assert self.rows is not None
        return self.rows

    async def raw_stream(self, *args: Any, **kwargs: Any) -> FakeAsyncRawContext:
        self.calls.append(("raw", args, kwargs))
        assert self.raw is not None
        return self.raw

    async def query(self, *args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a stream must not run a buffered query")


@dataclass
class FakeControl:
    killed: list[str] = field(default_factory=list)

    def command(self, cmd: str, parameters: dict[str, str]) -> object:
        self.killed.append(parameters["id"])
        return "ok"


@dataclass
class FakeAsyncControl:
    killed: list[str] = field(default_factory=list)

    async def command(self, cmd: str, parameters: dict[str, str]) -> object:
        self.killed.append(parameters["id"])
        return "ok"


def compiled(**kwargs: Any) -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:String} AS value",
        parameters={"p0": TypedParameter("p0", "String", "x")},
        **kwargs,
    )


ROWS = FakeRowContext(("n", "d"), [[(1, Decimal("1.50")), (2, None)], [(3, Decimal("2.00"))]])


# --- the sync ClickHouse executor ---------------------------------------------


def test_a_row_stream_sends_the_request_execute_would() -> None:
    client = FakeClient(rows=FakeRowContext(("n",), [[(1,)]]))
    query = compiled()
    with_stream = ClickHouseExecutor(client).stream(query)
    assert [batch.rows for batch in with_stream] == [((1,),)]

    kind, args, kwargs = client.calls[0]
    assert kind == "rows"
    assert args[0] == query.sql
    assert args[1] == {"p0": "x"}
    assert args[2]["query_id"] == query.query_id
    assert args[2]["readonly"] == 1
    assert kwargs == {"use_none": True, "tz_mode": "aware", "transport_settings": {}}


def test_a_row_stream_decodes_values_like_execute() -> None:
    rows = FakeRowContext(("n", "d"), [[(1, Decimal("1.50")), (2, None)], [(3, Decimal("2.00"))]])
    stream = ClickHouseExecutor(FakeClient(rows=rows)).stream(compiled())

    assert stream.columns == ("n", "d")
    assert [batch.rows for batch in stream] == [((1, "1.50"), (2, None)), ((3, "2.00"),)]
    assert rows.exited


def test_closing_early_releases_the_driver_and_kills_the_query() -> None:
    rows = FakeRowContext(("n",), [[(1,)], [(2,)]])
    control = FakeControl()
    query = compiled()
    stream = ClickHouseExecutor(FakeClient(rows=rows), control_client=control).stream(query)
    next(iter(stream))
    stream.close()
    stream.close()

    assert rows.exited
    assert control.killed == [query.query_id]


def test_a_finished_stream_kills_nothing() -> None:
    control = FakeControl()
    stream = ClickHouseExecutor(
        FakeClient(rows=FakeRowContext(("n",), [[(1,)]])), control_client=control
    ).stream(compiled())
    list(stream)
    assert control.killed == []


def test_cancellation_between_batches_stops_the_stream() -> None:
    cancelled = threading.Event()
    rows = FakeRowContext(("n",), [[(1,)], [(2,)]])
    control = FakeControl()
    stream = ClickHouseExecutor(FakeClient(rows=rows), control_client=control).stream(
        compiled(cancellation=cancelled)
    )
    batches = iter(stream)
    next(batches)
    cancelled.set()

    with pytest.raises(CompiledQueryError) as raised:
        next(batches)
    assert raised.value.category == "aborted"
    assert rows.exited
    assert control.killed


def test_a_mid_stream_server_error_maps_without_the_drivers_text() -> None:
    rows = FakeRowContext(("n",), [[(1,)], StreamFailureError(TOO_MANY)])
    stream = ClickHouseExecutor(FakeClient(rows=rows)).stream(compiled())
    batches = iter(stream)
    next(batches)

    with pytest.raises(CompiledQueryError) as raised:
        next(batches)
    assert raised.value.category == "too-large"
    assert "Limit" not in raised.value.message
    assert rows.exited


def test_an_arrow_stream_decodes_the_raw_body() -> None:
    batches = sample_batches()
    response = FakeResponse(arrow_body(batches, "lz4"))
    client = FakeClient(response=response)
    query = compiled()
    stream = ClickHouseExecutor(client).stream_arrow(query)

    assert stream.schema == batches[0].schema
    assert pa.Table.from_batches(list(stream)).equals(pa.Table.from_batches(batches))
    assert response.closed
    kind, args, kwargs = client.calls[0]
    assert kind == "raw"
    assert kwargs == {"fmt": "ArrowStream"}
    settings = args[2]
    # No output setting of its own: a read-only profile must accept the request.
    assert "output_format_arrow_string_as_string" not in settings
    assert settings["query_id"] == query.query_id


def test_an_arrow_stream_reports_clickhouses_error_after_a_connection_reset() -> None:
    body = arrow_body(sample_batches(8, 20_000))[:-100] + exception_block()
    response = FakeResponse(body, error=ConnectionResetError("reset"))
    stream = ClickHouseExecutor(FakeClient(response=response)).stream_arrow(compiled())

    with pytest.raises(CompiledQueryError) as raised:
        list(stream)
    assert raised.value.category == "too-large"
    assert response.closed


# --- the async executors --------------------------------------------------------


def test_the_native_async_executor_streams_rows_and_frees_its_slot() -> None:
    async def run() -> None:
        rows = FakeRowContext(("n", "d"), [[(1, Decimal("1.50"))], [(2, None)]])
        executor = AsyncClickHouseExecutor(
            FakeAsyncClient(rows=rows), FakeAsyncControl(), max_concurrent=1
        )
        stream = await executor.stream(compiled())
        assert executor._semaphore.locked()
        assert [batch.rows async for batch in stream] == [((1, "1.50"),), ((2, None),)]
        assert rows.exited
        assert not executor._semaphore.locked()

    asyncio.run(run())


def test_the_native_async_executor_kills_a_stream_closed_early() -> None:
    async def run() -> None:
        control = FakeAsyncControl()
        executor = AsyncClickHouseExecutor(
            FakeAsyncClient(rows=FakeRowContext(("n",), [[(1,)], [(2,)]])), control
        )
        query = compiled()
        stream = await executor.stream(query)
        await anext(aiter(stream))
        await stream.aclose()
        assert control.killed == [query.query_id]
        assert not executor._semaphore.locked()

    asyncio.run(run())


def test_the_native_async_executor_streams_arrow() -> None:
    async def run() -> None:
        batches = sample_batches()
        raw = FakeAsyncRawContext(arrow_body(batches))
        executor = AsyncClickHouseExecutor(FakeAsyncClient(raw=raw), FakeAsyncControl())
        stream = await executor.stream_arrow(compiled())
        assert stream.schema == batches[0].schema
        received = [batch async for batch in stream]
        assert pa.Table.from_batches(received).equals(pa.Table.from_batches(batches))
        assert raw.exited

    asyncio.run(run())


def test_the_native_async_arrow_stream_maps_a_mid_stream_failure() -> None:
    async def run() -> None:
        body = arrow_body(sample_batches(8, 20_000))[:-100] + exception_block()
        raw = FakeAsyncRawContext(body, error=ConnectionResetError("reset"))
        executor = AsyncClickHouseExecutor(FakeAsyncClient(raw=raw), FakeAsyncControl())
        stream = await executor.stream_arrow(compiled())
        with pytest.raises(CompiledQueryError) as raised:
            _ = [batch async for batch in stream]
        assert raised.value.category == "too-large"
        assert not executor._semaphore.locked()

    asyncio.run(run())


def test_the_native_async_arrow_stream_maps_a_startup_failure() -> None:
    async def run() -> None:
        raw = FakeAsyncRawContext(b"", error=ConnectionResetError("reset"))
        executor = AsyncClickHouseExecutor(FakeAsyncClient(raw=raw), FakeAsyncControl())
        with pytest.raises(CompiledQueryError) as raised:
            await executor.stream_arrow(compiled())
        assert raised.value.category == "unavailable"
        assert raw.exited
        assert not executor._semaphore.locked()

    asyncio.run(run())


class StalledRawContext(FakeAsyncRawContext):
    """Headers arrived; the first batch never does."""

    async def __aiter__(self) -> AsyncIterator[bytes]:
        await asyncio.Event().wait()
        yield b""


def test_the_native_async_arrow_first_batch_honours_cancellation() -> None:
    async def run() -> None:
        cancelled = threading.Event()
        control = FakeAsyncControl()
        raw = StalledRawContext(b"")
        executor = AsyncClickHouseExecutor(FakeAsyncClient(raw=raw), control)
        query = compiled(cancellation=cancelled)
        opening = asyncio.create_task(executor.stream_arrow(query))
        await asyncio.sleep(0.05)
        cancelled.set()
        with pytest.raises(CompiledQueryError) as raised:
            await asyncio.wait_for(opening, 2)
        assert raised.value.category == "aborted"
        assert control.killed[:1] == [query.query_id]
        assert not executor._semaphore.locked()

    asyncio.run(run())


def test_the_bridge_executor_kills_a_stream_closed_early() -> None:
    async def run() -> None:
        control = FakeControl()
        executor = AsyncFromSyncClickHouseExecutor(
            FakeClient(rows=FakeRowContext(("n",), [[(1,)], [(2,)]])), control
        )
        try:
            query = compiled()
            stream = await executor.stream(query)
            await anext(aiter(stream))
            await stream.aclose()
            assert control.killed == [query.query_id]
        finally:
            await executor.aclose()

    asyncio.run(run())


@dataclass
class HangingControl:
    """A KILL that never answers, so its caller is cancelled while waiting."""

    def command(self, cmd: str, parameters: dict[str, str]) -> object:
        threading.Event().wait(5)
        return "ok"


def test_a_close_cancelled_during_its_kill_still_frees_the_slot() -> None:
    async def run() -> None:
        executor = AsyncFromSyncClickHouseExecutor(
            FakeClient(rows=FakeRowContext(("n",), [[(1,)], [(2,)]])),
            HangingControl(),
            max_concurrent=1,
        )
        try:
            stream = await executor.stream(compiled())
            await anext(aiter(stream))
            closing = asyncio.create_task(stream.aclose())
            await asyncio.sleep(0.05)
            closing.cancel()
            with pytest.raises(asyncio.CancelledError):
                await closing
            for _ in range(100):
                if not executor._semaphore.locked():
                    break
                await asyncio.sleep(0.01)
            assert not executor._semaphore.locked()
        finally:
            executor.close()

    asyncio.run(run())


def test_the_bridge_executor_streams_on_its_workers() -> None:
    async def run() -> None:
        rows = FakeRowContext(("n",), [[(1,)], [(2,)]])
        executor = AsyncFromSyncClickHouseExecutor(
            FakeClient(rows=rows), FakeControl(), max_concurrent=1
        )
        try:
            stream = await executor.stream(compiled())
            assert [batch.rows async for batch in stream] == [((1,),), ((2,),)]
            for _ in range(100):
                if not executor._semaphore.locked():
                    break
                await asyncio.sleep(0.01)
            assert not executor._semaphore.locked()
        finally:
            await executor.aclose()

    asyncio.run(run())


# --- the clients -------------------------------------------------------------


@dataclass(frozen=True)
class _Batch:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class StreamingExecutor:
    """A client-level double: records what the client asks it to stream."""

    batches: list[_Batch]
    seen: list[CompiledQuery] = field(default_factory=list)
    closed: int = 0

    def execute(self, compiled: CompiledQuery) -> _Batch:
        self.seen.append(compiled)
        return _Batch(self.batches[0].columns, tuple(r for b in self.batches for r in b.rows))

    def stream(self, compiled: CompiledQuery) -> Any:
        self.seen.append(compiled)
        owner = self

        class _Stream:
            columns = owner.batches[0].columns if owner.batches else ()

            def __iter__(self) -> Iterator[_Batch]:
                return iter(owner.batches)

            def close(self) -> None:
                owner.closed += 1

        return _Stream()


@dataclass
class AsyncStreamingExecutor:
    inner: StreamingExecutor

    async def execute(self, compiled: CompiledQuery) -> _Batch:
        return self.inner.execute(compiled)

    async def stream(self, compiled: CompiledQuery) -> Any:
        sync = self.inner.stream(compiled)

        class _Stream:
            columns = sync.columns

            async def __aiter__(self) -> AsyncIterator[_Batch]:
                for batch in sync:
                    yield batch

            async def aclose(self) -> None:
                sync.close()

        return _Stream()


def trips() -> Dataset:
    return Dataset(
        name="trips",
        source="analytics.trips",
        tenant_key="org_id",
        dimensions={"vendor": dimension("string")},
        measures={"trips": measure(count("id")), "fare": measure(sum_("fare"))},
    )


QUERY = DatasetQuery(dimensions=("vendor",), measures=("trips",), limit=10)
ACME = ExecutionContext(tenant=tenant("acme"))
BATCHES = [
    _Batch(("vendor", "trips"), (("a", 1), ("b", 2))),
    _Batch(("vendor", "trips"), (("c", 3),)),
]


def test_a_client_stream_runs_the_query_execute_would() -> None:
    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    with client.stream(trips(), QUERY, context=ACME) as stream:
        batches = list(stream)
    client.execute(trips(), QUERY, context=ACME)

    streamed, executed = executor.seen
    assert streamed.sql == executed.sql
    assert streamed.parameters == executed.parameters
    assert "acme" in [parameter.value for parameter in streamed.parameters.values()]
    assert batches == [
        ({"vendor": "a", "trips": 1}, {"vendor": "b", "trips": 2}),
        ({"vendor": "c", "trips": 3},),
    ]
    assert stream.columns == ("vendor", "trips")
    assert len(stream.column_types) == 2
    assert stream.query_id == streamed.query_id
    assert executor.closed == 1


def test_a_client_stream_is_never_paginated() -> None:
    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    list(client.stream(trips(), QUERY, context=ACME))
    client.execute(trips(), QUERY, context=ACME, paginate=True)

    streamed, paginated = executor.seen
    assert streamed.sql != paginated.sql  # pagination over-fetches a probe row


def test_rows_flattens_the_batches() -> None:
    client = create_dataset_client(executor=StreamingExecutor(BATCHES))
    with client.stream(trips(), QUERY, context=ACME) as stream:
        assert [row["vendor"] for row in stream.rows()] == ["a", "b", "c"]


def test_an_invalid_query_raises_before_anything_is_sent() -> None:
    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    with pytest.raises(CompiledQueryError):
        client.stream(trips(), DatasetQuery(measures=("missing",)), context=ACME)
    with pytest.raises(CompiledQueryError):
        client.stream(trips(), QUERY)  # no tenant
    assert executor.seen == []


def test_the_query_starts_when_the_stream_is_entered() -> None:
    executor = StreamingExecutor(BATCHES)
    stream = create_dataset_client(executor=executor).stream(trips(), QUERY, context=ACME)
    assert executor.seen == []
    with stream:
        assert len(executor.seen) == 1
    with pytest.raises(RuntimeError, match="closed"):
        list(stream)


def test_an_executor_that_cannot_stream_is_refused() -> None:
    class BufferedOnly:
        def execute(self, compiled: CompiledQuery) -> _Batch:
            raise AssertionError

    client = create_dataset_client(executor=BufferedOnly())
    with pytest.raises(TypeError, match="cannot stream"):
        client.stream(trips(), QUERY, context=ACME)
    with pytest.raises(TypeError, match="cannot stream"):
        client.stream_arrow(trips(), QUERY, context=ACME)


def test_a_tenant_bound_client_streams_as_its_tenant() -> None:
    executor = StreamingExecutor(BATCHES)
    bound = create_dataset_client(executor=executor).for_tenant(tenant("acme"))
    with bound.stream(trips(), QUERY) as stream:
        list(stream)
    assert "acme" in [parameter.value for parameter in executor.seen[0].parameters.values()]


def test_the_async_client_streams() -> None:
    async def run() -> None:
        inner = StreamingExecutor(BATCHES)
        client = create_async_dataset_client(executor=AsyncStreamingExecutor(inner))
        async with client.stream(trips(), QUERY, context=ACME) as stream:
            rows = [row async for row in stream.rows()]
        assert [row["trips"] for row in rows] == [1, 2, 3]
        assert inner.closed == 1

        bound = client.for_tenant(tenant("acme"))
        async with bound.stream(trips(), QUERY) as stream:
            assert len([batch async for batch in stream]) == 2

    asyncio.run(run())


# --- stream ceilings -----------------------------------------------------------


def exports() -> Dataset:
    from hypequery.datasets import DatasetLimits

    return Dataset(
        name="exports",
        source="analytics.trips",
        dimensions={"vendor": dimension("string")},
        measures={"trips": measure(count("id"))},
        limits=DatasetLimits(max_result_size=10, max_stream_rows=1000),
    )


def test_a_stream_may_use_max_stream_rows_while_pages_keep_max_result_size() -> None:
    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    query = DatasetQuery(dimensions=("vendor",), measures=("trips",), limit=500)

    with client.stream(exports(), query) as stream:
        list(stream)
    assert executor.seen[0].sql.endswith("LIMIT 500")

    with pytest.raises(CompiledQueryError) as raised:
        client.execute(exports(), query)
    assert raised.value.category == "too-large"
    with pytest.raises(CompiledQueryError):
        client.stream(exports(), query.model_copy(update={"limit": 1001}))


def test_streams_take_their_own_byte_ceiling() -> None:
    from hypequery.datasets.planner import query_settings
    from hypequery.datasets.planner.settings import STREAM_MAX_RESULT_BYTES

    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    list(client.stream(trips(), QUERY, context=ACME))
    client.execute(trips(), QUERY, context=ACME)
    streamed, executed = executor.seen
    assert streamed.settings["max_result_bytes"] == STREAM_MAX_RESULT_BYTES
    assert executed.settings["max_result_bytes"] == 64 << 20
    # Rows and time stay as the client set them.
    assert streamed.settings["max_result_rows"] == executed.settings["max_result_rows"]

    custom = create_dataset_client(executor=executor, stream_max_result_bytes=5 << 30)
    list(custom.stream(trips(), QUERY, context=ACME))
    assert executor.seen[-1].settings["max_result_bytes"] == 5 << 30

    # A request context still tightens it, as serve's production profile does.
    tight = ExecutionContext(
        tenant=tenant("acme"), settings=query_settings(max_result_bytes=1 << 20)
    )
    list(client.stream(trips(), QUERY, context=tight))
    assert executor.seen[-1].settings["max_result_bytes"] == 1 << 20

    with pytest.raises(CompiledQueryError):
        create_dataset_client(
            executor=executor, stream_max_result_bytes=STREAM_MAX_RESULT_BYTES + 1
        )


def test_deployment_contracts_refuse_max_stream_rows() -> None:
    from hypequery.datasets import create_dataset_registry
    from hypequery.datasets.deployment import build_protocol_deployment_contract

    with pytest.raises(ValueError, match=r"limits\.max_stream_rows, which is not part of"):
        build_protocol_deployment_contract(create_dataset_registry(exports()))


def test_an_unbounded_stream_runs_under_max_stream_rows() -> None:
    from hypequery.datasets import DatasetLimits

    executor = StreamingExecutor(BATCHES)
    client = create_dataset_client(executor=executor)
    unbounded = DatasetQuery(dimensions=("vendor",), measures=("trips",))

    list(client.stream(exports(), unbounded))
    client.execute(exports(), unbounded)
    streamed, executed = executor.seen
    # A stream that sets no limit reaches its own ceiling, not the page's.
    assert streamed.sql.endswith("LIMIT 1000")
    assert executed.sql.endswith("LIMIT 10")

    only_streams = Dataset(
        name="only_streams",
        source="analytics.trips",
        dimensions={"vendor": dimension("string")},
        measures={"trips": measure(count("id"))},
        limits=DatasetLimits(max_stream_rows=500),
    )
    list(client.stream(only_streams, unbounded))
    client.execute(only_streams, unbounded)
    assert executor.seen[-2].sql.endswith("LIMIT 500")
    assert "LIMIT" not in executor.seen[-1].sql


def test_a_window_stream_plans_under_max_stream_rows() -> None:
    from hypequery.datasets import DatasetLimits, dataset, filter  # noqa: A004
    from hypequery.datasets import measure as m
    from hypequery.datasets.planner import plan_dataset_query

    windowed = dataset(
        "sales",
        source="sales",
        time_key="sold_at",
        dimensions={"soldAt": dimension.timestamp(column="sold_at")},
        measures={"revenue": m.sum("amount"), "running": m.cumulative("revenue")},
        limits=DatasetLimits(max_result_size=5, max_stream_rows=100),
    )
    january = DatasetQuery(
        measures=("running",),
        by="day",
        filters=(filter.gte("soldAt", "2026-01-01"), filter.lt("soldAt", "2026-02-01")),
    )
    # 31 daily buckets: over the page ceiling, within the stream ceiling.
    with pytest.raises(CompiledQueryError):
        plan_dataset_query(windowed, january)
    assert plan_dataset_query(windowed, january, stream=True).sql
