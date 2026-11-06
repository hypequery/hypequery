"""Embedded ClickHouse (chDB) execution of compiled queries.

chDB runs the ClickHouse engine inside this process: no server, no
credentials, and the same compiled SQL the HTTP executors send. Values still
travel as typed query parameters, and the planner's limits, ``readonly``
included, ride in the statement's ``SETTINGS`` clause because chDB has no
separate settings argument.

A chDB connection runs one query at a time and cannot stop one once it has
started. Cancellation and deadlines are checked before and after the call, the
async executor returns to its caller at once, and ``max_execution_time`` ends
the abandoned query inside the engine.
"""

from __future__ import annotations

import asyncio
import threading
import weakref
from collections.abc import Callable, Collection, Iterator
from concurrent.futures import ThreadPoolExecutor
from types import TracebackType
from typing import TYPE_CHECKING, Any, Protocol, Self, TypeVar, cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, safe_identifier

from .cancellation import acquire_slot, run_with_policy, terminal_error
from .errors import chdb_driver_error, server_message_error
from .parameters import query_arguments
from .results import QueryRows, decode_result
from .streams import SyncBatchStream, ThreadedBatchStream, open_threaded
from .utils.arrow_ipc import require_pyarrow
from .utils.json_compact import (
    JSON_COMPACT_EACH_ROW,
    JSON_COMPACT_SETTINGS,
    decode_json_compact,
    decode_json_compact_each_row,
)
from .utils.parameter_text import parameter_text
from .utils.settings_clause import with_settings, within_deadline

if TYPE_CHECKING:
    import pyarrow as pa

_B = TypeVar("_B")

#: chDB's own name for a database that lives only as long as the process.
IN_MEMORY = ":memory:"

#: Executors open in this process, with the database path each holds when it
#: came from the factories below, so a process that imported an app only to
#: check it can release the app's database for the process that serves it.
_OPEN_EXECUTORS: weakref.WeakKeyDictionary[ChdbExecutor | AsyncChdbExecutor, str | None] = (
    weakref.WeakKeyDictionary()
)


class _ChdbResult(Protocol):
    def bytes(self) -> bytes: ...


class _ChdbConnection(Protocol):
    """``chdb.connect()``'s connection or a ``chdb.session.Session``."""

    def query(self, sql: str, fmt: str = ..., *, params: dict[str, str] | None = ...) -> object: ...


def _payload(result: object, query_id: str) -> bytes:
    reader = getattr(result, "bytes", None)
    payload = reader() if callable(reader) else None
    if type(payload) is not bytes:
        raise CompiledQueryError("internal", "invalid result", query_id=query_id)
    return payload


class ChdbExecutor:
    """Execute a trusted compiled SELECT on an embedded chDB connection.

    chDB admits one query per connection at a time. Queries queue on this
    executor's lock rather than inside chDB, so a caller whose deadline expires
    while queued fails without starting. A started query cannot be stopped, so
    its ``max_execution_time`` is brought forward to the caller's deadline.
    """

    def __init__(self, connection: _ChdbConnection) -> None:
        self._connection = connection
        self._lock = threading.Lock()
        _OPEN_EXECUTORS[self] = None

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        parameters, settings = query_arguments(compiled)
        params = {name: parameter_text(value) for name, value in parameters.items()}
        deadline = compiled.deadline
        if not self._lock.acquire(timeout=-1 if deadline is None else max(0, deadline.remaining())):
            raise terminal_error(compiled) or CompiledQueryError(
                "deadline-exceeded", "The query timed out.", query_id=compiled.query_id
            )
        try:
            reason = terminal_error(compiled)
            if reason is not None:
                raise reason
            limits = within_deadline(settings, None if deadline is None else deadline.remaining())
            sql = with_settings(compiled.sql, limits, JSON_COMPACT_SETTINGS)
            try:
                result = self._connection.query(sql, "JSONCompact", params=params)
            except Exception as exc:
                # A cancelled or expired query fails because the caller stopped it.
                raise (
                    terminal_error(compiled) or chdb_driver_error(exc, compiled.query_id)
                ) from None
        finally:
            self._lock.release()
        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        payload = _payload(result, compiled.query_id)
        return decode_result(decode_json_compact(payload, compiled.query_id), compiled.query_id)

    def _streaming(self) -> Callable[..., Any]:
        """The connection's ``send_query``, refused clearly when it cannot stream."""

        send_query = getattr(self._connection, "send_query", None)
        if not callable(send_query):
            raise TypeError(f"{type(self._connection).__name__} cannot stream results")
        return cast(Callable[..., Any], send_query)

    def _admit(self, compiled: CompiledQuery) -> None:
        """Take the connection for *compiled*, queued no later than its deadline."""

        deadline = compiled.deadline
        if not self._lock.acquire(timeout=-1 if deadline is None else max(0, deadline.remaining())):
            raise terminal_error(compiled) or CompiledQueryError(
                "deadline-exceeded", "The query timed out.", query_id=compiled.query_id
            )

    def _send(self, compiled: CompiledQuery, fmt: str, output: dict[str, str]) -> Any:
        """Start *compiled* as a chDB stream; the caller holds the connection."""

        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        parameters, settings = query_arguments(compiled)
        params = {name: parameter_text(value) for name, value in parameters.items()}
        deadline = compiled.deadline
        limits = within_deadline(settings, None if deadline is None else deadline.remaining())
        send_query = self._streaming()
        try:
            return send_query(with_settings(compiled.sql, limits, output), fmt, params=params)
        except Exception as exc:
            raise (terminal_error(compiled) or chdb_driver_error(exc, compiled.query_id)) from None

    def stream(self, compiled: CompiledQuery) -> SyncBatchStream[QueryRows]:
        """Run *compiled* and hand its rows over chunk by chunk.

        The connection stays this stream's until it closes: other queries on
        this executor wait for it, as they wait for a running query.
        """

        self._admit(compiled)
        result: Any = None
        try:
            result = self._send(compiled, JSON_COMPACT_EACH_ROW, dict(JSON_COMPACT_SETTINGS))
            chunks = iter(result)
            first = next(chunks, None)
            batch = None if first is None else self._decode_chunk(first, compiled)
        except BaseException as exc:
            self._release(result)
            if isinstance(exc, CompiledQueryError) or not isinstance(exc, Exception):
                raise
            raise (terminal_error(compiled) or chdb_driver_error(exc, compiled.query_id)) from None

        def batches() -> Iterator[QueryRows]:
            if batch is None:
                return
            yield batch
            for chunk in chunks:
                yield self._decode_chunk(chunk, compiled)

        return SyncBatchStream(
            compiled,
            batches(),
            release=lambda: self._release(result),
            fail=lambda exc: server_message_error(str(exc), compiled.query_id),
            columns=() if batch is None else batch.columns,
        )

    def stream_arrow(self, compiled: CompiledQuery) -> SyncBatchStream[pa.RecordBatch]:
        """Run *compiled* and hand its result over as Arrow record batches.

        An empty result's schema has no fields: chDB sends none without rows.
        Requires ``hypequery[arrow]``.
        """

        require_pyarrow()
        self._streaming()
        self._admit(compiled)
        result: Any = None
        try:
            result = self._send(compiled, "Arrow", {})
            reader = result.record_batch()
            schema = reader.schema
        except BaseException as exc:
            self._release(result)
            if isinstance(exc, CompiledQueryError) or not isinstance(exc, Exception):
                raise
            raise (terminal_error(compiled) or chdb_driver_error(exc, compiled.query_id)) from None
        return SyncBatchStream(
            compiled,
            iter(reader),
            release=lambda: self._release(result),
            fail=lambda exc: server_message_error(str(exc), compiled.query_id),
            schema=schema,
        )

    @staticmethod
    def _decode_chunk(chunk: object, compiled: CompiledQuery) -> QueryRows:
        payload = _payload(chunk, compiled.query_id)
        return decode_result(
            decode_json_compact_each_row(payload, compiled.query_id), compiled.query_id
        )

    def _release(self, result: Any) -> None:
        """End a stream: stop chDB's side, then give the connection back."""

        try:
            if result is not None:
                result.close()
        finally:
            self._lock.release()

    def close(self) -> None:
        """Close the chDB connection; an in-memory database goes with the last one.

        chDB cannot stop a running query, so closing waits for one to finish.
        """

        _OPEN_EXECUTORS.pop(self, None)
        closer = getattr(self._connection, "close", None)
        if callable(closer):
            closer()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


def open_chdb_executors() -> set[ChdbExecutor | AsyncChdbExecutor]:
    """The chDB executors open in this process; see :func:`release_chdb_databases_opened_since`."""

    return set(_OPEN_EXECUTORS)


def release_chdb_databases_opened_since(
    before: Collection[ChdbExecutor | AsyncChdbExecutor],
) -> int:
    """Close the executors opened since *before* and free their databases; how many closed.

    *before* is an earlier :func:`open_chdb_executors`. chDB holds an on-disk
    database directory for one process, so a process that imports an app only
    to check it, such as the development server's reload supervisor, releases
    the app's database for the process that serves it: the executors the
    import opened close, and so does any earlier executor on the same on-disk
    path, which :func:`create_chdb_executor` and its async twin record.
    Executors on other paths, on in-memory databases, or built directly on a
    connection stay open.
    """

    opened = [executor for executor in _OPEN_EXECUTORS if executor not in before]
    paths = {_OPEN_EXECUTORS[executor] for executor in opened} - {None, IN_MEMORY}
    earlier = [
        executor
        for executor in before
        if executor in _OPEN_EXECUTORS and _OPEN_EXECUTORS[executor] in paths
    ]
    for executor in [*opened, *earlier]:
        executor.close()
    return len(opened) + len(earlier)


class AsyncChdbExecutor:
    """Run a :class:`ChdbExecutor` on one worker thread, off the event loop.

    chDB runs one query at a time, so callers queue for the single worker and
    a cancelled or expired caller leaves the queue at once. A query already
    running cannot be stopped: its caller gets the cancellation or deadline
    error immediately while ``max_execution_time`` ends the query.
    """

    def __init__(self, connection: _ChdbConnection) -> None:
        self._sync = ChdbExecutor(connection)
        # Registered once, as the executor a caller holds.
        _OPEN_EXECUTORS[self] = _OPEN_EXECUTORS.pop(self._sync)
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hypequery-chdb")
        self._semaphore = asyncio.Semaphore(1)
        self._closed = False

    def _release_slot_from_worker(self, loop: asyncio.AbstractEventLoop) -> None:
        try:
            loop.call_soon_threadsafe(self._semaphore.release)
        except RuntimeError:
            # The loop closed before the abandoned query returned.
            return

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        submitted = False
        try:
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
            loop = asyncio.get_running_loop()
            future = self._worker.submit(self._sync.execute, compiled)
            submitted = True
            work = asyncio.wrap_future(future)
            work.add_done_callback(_retrieve_outcome)
            return await run_with_policy(work, compiled, None)
        finally:
            # The slot is free only once the engine is: a later query would
            # otherwise wait inside chDB, past its own deadline.
            if submitted and not future.done():
                future.add_done_callback(lambda _: self._release_slot_from_worker(loop))
            else:
                self._semaphore.release()

    async def _open_threaded(
        self, compiled: CompiledQuery, open_sync: Callable[[], SyncBatchStream[_B]]
    ) -> ThreadedBatchStream[_B]:
        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        loop = asyncio.get_running_loop()
        try:
            # Re-checked: the executor may have closed while this call queued.
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        except BaseException:
            self._semaphore.release()
            raise
        return await open_threaded(
            compiled,
            self._worker,
            open_sync,
            release_slot=lambda: self._release_slot_from_worker(loop),
            cancel_on_server=None,
        )

    async def stream(self, compiled: CompiledQuery) -> ThreadedBatchStream[QueryRows]:
        """Stream *compiled*'s rows from the worker; other queries wait until it closes."""

        return await self._open_threaded(compiled, lambda: self._sync.stream(compiled))

    async def stream_arrow(self, compiled: CompiledQuery) -> ThreadedBatchStream[pa.RecordBatch]:
        """Stream *compiled* as Arrow record batches from the worker."""

        require_pyarrow()
        return await self._open_threaded(compiled, lambda: self._sync.stream_arrow(compiled))

    def close(self) -> None:
        """Stop admitting work and close the connection.

        For shutdown without an event loop. Queued work is dropped, but a
        query already running on the worker finishes first: chDB cannot stop
        it, and its close waits for it, so this blocks for up to the query's
        time limit. :meth:`aclose` does the same without blocking the event
        loop.
        """

        self._closed = True
        _OPEN_EXECUTORS.pop(self, None)
        self._worker.shutdown(wait=False, cancel_futures=True)
        self._sync.close()

    async def aclose(self) -> None:
        """Wait for the running query to end, then close the connection."""

        self._closed = True
        _OPEN_EXECUTORS.pop(self, None)
        self._worker.shutdown(wait=False, cancel_futures=True)
        await asyncio.to_thread(self._worker.shutdown, wait=True)
        await asyncio.to_thread(self._sync.close)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()


def _retrieve_outcome(done: asyncio.Future[QueryRows]) -> None:
    # A caller that gave up never reads the worker's outcome; mark it retrieved
    # so asyncio does not log the abandoned exception at garbage collection.
    if not done.cancelled():
        done.exception()


def _connect(path: str, database: str) -> _ChdbConnection:
    if type(path) is not str or not path:
        raise ValueError("path must be a non-empty string, or ':memory:'")
    try:
        use = f"USE {safe_identifier(database, what='database').sql}"
    except CompiledQueryError:
        raise ValueError("database must be a valid ClickHouse identifier") from None
    try:
        import chdb
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Install "hypequery[chdb]" to use embedded chDB execution.', name=exc.name
        ) from exc
    try:
        connection: _ChdbConnection = chdb.connect(path)
    except Exception as exc:
        # Startup configuration, not a request: say what to fix and keep the cause.
        raise RuntimeError(
            f"chDB could not open {path!r} ({exc}). A process holds one chDB path at a "
            "time; if another path is open, close every chDB connection or session on "
            "it first."
        ) from exc
    if database != "default":
        try:
            # USE holds for this connection only, as a server connection's database does.
            connection.query(use)
        except Exception as exc:
            closer = getattr(connection, "close", None)
            if callable(closer):
                closer()
            raise RuntimeError(f"chDB has no database {database!r} at {path!r}.") from exc
    return connection


def create_chdb_executor(path: str = IN_MEMORY, *, database: str = "default") -> ChdbExecutor:
    """Open an embedded chDB database. Install ``hypequery[chdb]`` first.

    *path* is a directory that keeps its tables between runs, or
    ``":memory:"``, whose tables are discarded when the last connection to it
    closes. chDB holds one path per process: every connection to it shares one
    engine, and another path opens only once they are all closed. Unqualified
    dataset sources resolve in *database*, which must already exist.
    """

    executor = ChdbExecutor(_connect(path, database))
    _OPEN_EXECUTORS[executor] = path
    return executor


def create_async_chdb_executor(
    path: str = IN_MEMORY, *, database: str = "default"
) -> AsyncChdbExecutor:
    """An async executor over an embedded chDB database; see :func:`create_chdb_executor`."""

    executor = AsyncChdbExecutor(_connect(path, database))
    _OPEN_EXECUTORS[executor] = path
    return executor
