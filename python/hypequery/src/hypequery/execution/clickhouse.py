"""Sync and async ClickHouse execution of compiled queries."""

from __future__ import annotations

import asyncio
import os
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from importlib.util import find_spec
from types import TracebackType
from typing import TYPE_CHECKING, Any, Protocol, Self, TypedDict, TypeVar, cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

from .cancellation import KillRetries, acquire_slot, run_with_policy, terminal_error
from .errors import safe_driver_error
from .parameters import query_arguments
from .readonly_settings import (
    ReadonlyPolicy,
    readonly_setting_error,
    validate_readonly_policy,
    wire_settings,
)
from .results import DriverResult, QueryRows, decode_columns, decode_result, decode_rows
from .streams import (
    ARROW_CHUNK_BYTES,
    AsyncBatchStream,
    SyncBatchStream,
    ThreadedBatchStream,
    apeek,
    arrow_batches,
    async_arrow_batches,
    open_threaded,
    peek,
)
from .sync_cancellation import SyncCancellationMonitor
from .utils.arrow_ipc import ArrowIpcDecoder, require_pyarrow
from .utils.close_cancellation import cancels_on_close
from .utils.connection_env import connection_fields, control_fields
from .utils.connection_url import url_fields

if TYPE_CHECKING:
    import pyarrow as pa

_B = TypeVar("_B")


@dataclass(frozen=True, slots=True)
class ClickHouseConnection:
    """Explicit connection fields and readonly policy; passwords are never logged.

    Cancellation sends ``KILL QUERY`` on a separate control connection. By
    default it signs in as *username*, which then needs
    ``GRANT SELECT ON system.processes``. Set *control_username* to cancel as a
    different user instead; that user needs ``SELECT ON system.processes`` and
    ``KILL QUERY``.
    """

    host: str = "localhost"
    port: int | None = None
    database: str = "default"
    username: str = "default"
    password: str = field(default="", repr=False)
    secure: bool = False
    readonly_policy: ReadonlyPolicy = "query"
    control_username: str | None = None
    control_password: str = field(default="", repr=False)

    def __post_init__(self) -> None:
        validate_readonly_policy(self.readonly_policy)
        if self.control_username is None and self.control_password:
            raise ValueError("control_password needs control_username")

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        readonly_policy: ReadonlyPolicy = "query",
    ) -> Self:
        """Read ``CLICKHOUSE_HOST``, ``_PORT``, ``_DATABASE``, ``_USERNAME``,
        ``_PASSWORD``, ``_SECURE``, ``_CONTROL_USERNAME`` and
        ``_CONTROL_PASSWORD``, defaulting to a local server.

        ``CLICKHOUSE_URL`` may replace the first six, read as :meth:`from_url`
        reads a URL; setting it alongside any of them is an error.

        An unset port lets the driver choose 8123, or 8443 when secure.
        """

        source = os.environ if environ is None else environ
        return cls(
            **connection_fields(source), **control_fields(source), readonly_policy=readonly_policy
        )

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        readonly_policy: ReadonlyPolicy = "query",
        control_username: str | None = None,
        control_password: str = "",
    ) -> Self:
        """Read ``scheme://user:password@host:port/database``.

        ``clickhouse://`` and ``http://`` are plain HTTP; ``clickhouses://`` and
        ``https://`` are TLS. SQLAlchemy URLs for the HTTP interface also work
        (``clickhousedb://`` and ``clickhouse+http://``), with ``?secure=true``
        or ``?protocol=https`` choosing TLS. Native-protocol URLs
        (``clickhouse+native://``) are refused: hypequery's server-side
        parameters need the HTTP interface. User and password are
        percent-decoded; an omitted database is ``default``.
        """

        return cls(
            **url_fields(url),
            readonly_policy=readonly_policy,
            control_username=control_username,
            control_password=control_password,
        )


class _SyncClient(Protocol):
    def query(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        use_none: bool,
        tz_mode: str,
        transport_settings: dict[str, str],
    ) -> DriverResult: ...


class _AsyncClient(Protocol):
    async def query(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        use_none: bool,
        tz_mode: str,
        transport_settings: dict[str, str],
    ) -> DriverResult: ...


class _SyncStreamingClient(_SyncClient, Protocol):
    """A driver client that can also stream; clickhouse-connect's is one."""

    def query_row_block_stream(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        use_none: bool,
        tz_mode: str,
        transport_settings: dict[str, str],
    ) -> Any: ...

    def raw_stream(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        fmt: str,
    ) -> Any: ...


class _AsyncStreamingClient(_AsyncClient, Protocol):
    async def query_row_block_stream(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        use_none: bool,
        tz_mode: str,
        transport_settings: dict[str, str],
    ) -> Any: ...

    async def raw_stream(
        self,
        query: str,
        parameters: dict[str, object],
        settings: dict[str, int | str],
        *,
        fmt: str,
    ) -> Any: ...


def _streaming(client: object) -> Any:
    """*client* for a stream, refused clearly when its driver cannot stream."""

    if not callable(getattr(client, "query_row_block_stream", None)) or not callable(
        getattr(client, "raw_stream", None)
    ):
        raise TypeError(f"{type(client).__name__} cannot stream results")
    return client


class _SyncControlClient(Protocol):
    def command(self, cmd: str, parameters: dict[str, str]) -> object: ...


class _AsyncControlClient(Protocol):
    async def command(self, cmd: str, parameters: dict[str, str]) -> object: ...


_KILL_QUERY = "KILL QUERY WHERE query_id = {id:String} SYNC"
#: A stream closed early asks without waiting: the query is blocked writing to
#: a caller that stopped reading, so a SYNC kill would wait out its timeout.
_KILL_QUERY_ASYNC = "KILL QUERY WHERE query_id = {id:String} ASYNC"

#: The ClickHouse header naming the tag of a mid-stream exception block.
_EXCEPTION_TAG_HEADER = "X-ClickHouse-Exception-Tag"


def _wire(
    client: object, compiled: CompiledQuery, policy: ReadonlyPolicy, *, stream: bool = False
) -> tuple[dict[str, object], dict[str, int | str]]:
    """The parameters and settings one request for *compiled* sends."""

    parameters, settings = query_arguments(compiled, stream=stream)
    selected = wire_settings(client, settings, policy, compiled.query_id)
    # The driver's settings path puts query_id in HTTP parameters.
    # transport_settings becomes headers, which ClickHouse ignores here.
    return parameters, {**selected, "query_id": compiled.query_id}


def _row_blocks(context: Any, columns: tuple[str, ...], query_id: str) -> Iterator[QueryRows]:
    for block in context:
        yield decode_rows(columns, block, query_id)


async def _async_row_blocks(
    context: Any, columns: tuple[str, ...], query_id: str
) -> AsyncIterator[QueryRows]:
    async for block in context:
        yield decode_rows(columns, block, query_id)


def _capacity(value: int) -> int:
    if type(value) is not int or not 1 <= value <= 128:
        raise ValueError("max_concurrent must be an integer between 1 and 128")
    return value


def _driver_failure(
    exc: Exception, compiled: CompiledQuery, policy: ReadonlyPolicy
) -> CompiledQueryError:
    """The public error for a failed driver call, never the driver's own text.

    Readonly guidance outranks the generic mapping because it is the one
    failure an operator can fix from the diagnostic alone.
    """

    guidance = readonly_setting_error(exc, policy, compiled.query_id)
    if guidance is not None:
        return guidance
    return safe_driver_error(exc, compiled.query_id)


class _ClientKwargs(TypedDict):
    autogenerate_session_id: bool
    host: str
    port: int | None
    database: str
    username: str
    password: str
    secure: bool


def _client_kwargs(connection: ClickHouseConnection) -> _ClientKwargs:
    """Connection fields shared by the query and cancellation-control clients."""

    return {
        # A process-wide executor serves overlapping HTTP/worker queries. The
        # driver's generated session locks the client to one active query.
        # Queries use explicit settings/parameters and need no session state.
        "autogenerate_session_id": False,
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": connection.password,
        "secure": connection.secure,
    }


#: The control connection only sends KILL QUERY, so it fails fast.
_CONTROL_TIMEOUT_SECONDS = 2


def _control_kwargs(connection: ClickHouseConnection) -> dict[str, Any]:
    """The cancellation-control client: the query user unless one is configured."""

    kwargs: dict[str, Any] = {
        **_client_kwargs(connection),
        "send_receive_timeout": _CONTROL_TIMEOUT_SECONDS,
    }
    if connection.control_username is not None:
        kwargs["username"] = connection.control_username
        kwargs["password"] = connection.control_password
    return kwargs


class ClickHouseExecutor:
    """Execute a trusted compiled SELECT with native server parameters."""

    def __init__(
        self,
        client: _SyncClient,
        *,
        readonly_policy: ReadonlyPolicy = "query",
        control_client: _SyncControlClient | None = None,
    ) -> None:
        validate_readonly_policy(readonly_policy)
        self._client = client
        self._readonly_policy = readonly_policy
        self._control_client = control_client
        self._control_lock = threading.Lock()

    def _cancel_on_server(self, query_id: str, statement: str = _KILL_QUERY) -> object:
        if self._control_client is None:
            return None
        try:
            with self._control_lock:
                return self._control_client.command(statement, {"id": query_id})
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        parameters, query_settings = _wire(self._client, compiled, self._readonly_policy)
        monitor = (
            SyncCancellationMonitor(compiled, self._cancel_on_server)
            if self._control_client is not None
            else None
        )
        if monitor is not None:
            monitor.start()
        try:
            result = self._client.query(
                compiled.sql,
                parameters,
                query_settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={},
            )
        except Exception as exc:
            # A cancelled or expired query fails because the caller stopped it,
            # whatever the interrupted driver call reported.
            raise (
                terminal_error(compiled) or _driver_failure(exc, compiled, self._readonly_policy)
            ) from None
        finally:
            if monitor is not None:
                monitor.stop()
        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        return decode_result(result, compiled.query_id)

    def _monitor(self, compiled: CompiledQuery) -> SyncCancellationMonitor | None:
        if self._control_client is None:
            return None
        monitor = SyncCancellationMonitor(compiled, self._cancel_on_server)
        monitor.start()
        return monitor

    def _abandon(self, compiled: CompiledQuery) -> Callable[[], object] | None:
        if self._control_client is None:
            return None
        return lambda: self._cancel_on_server(compiled.query_id, _KILL_QUERY_ASYNC)

    def stream(self, compiled: CompiledQuery) -> SyncBatchStream[QueryRows]:
        """Run *compiled* and hand its rows over block by block; close the stream to stop it."""

        client = cast(_SyncStreamingClient, _streaming(self._client))
        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        parameters, query_settings = _wire(
            self._client, compiled, self._readonly_policy, stream=True
        )
        monitor = self._monitor(compiled)
        context: Any = None
        try:
            context = client.query_row_block_stream(
                compiled.sql,
                parameters,
                query_settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={},
            )
            context.__enter__()
            columns = decode_columns(context.source.column_names, compiled.query_id)
        except Exception as exc:
            if context is not None:
                with suppress(Exception):
                    context.__exit__(None, None, None)
            if monitor is not None:
                monitor.stop()
            if isinstance(exc, CompiledQueryError):
                raise
            raise (
                terminal_error(compiled) or _driver_failure(exc, compiled, self._readonly_policy)
            ) from None

        def release() -> None:
            try:
                context.__exit__(None, None, None)
            finally:
                if monitor is not None:
                    monitor.stop()

        return SyncBatchStream(
            compiled,
            _row_blocks(context, columns, compiled.query_id),
            release=release,
            fail=lambda exc: _driver_failure(exc, compiled, self._readonly_policy),
            abandon=self._abandon(compiled),
            columns=columns,
        )

    def stream_arrow(self, compiled: CompiledQuery) -> SyncBatchStream[pa.RecordBatch]:
        """Run *compiled* and hand its result over as Arrow record batches.

        The body is ClickHouse's ``ArrowStream``, decoded here so a query that
        fails after its first batches reports ClickHouse's error. Requires
        ``hypequery[arrow]``.
        """

        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        require_pyarrow()
        client = cast(_SyncStreamingClient, _streaming(self._client))
        parameters, query_settings = _wire(
            self._client, compiled, self._readonly_policy, stream=True
        )
        monitor = self._monitor(compiled)
        response: Any = None
        try:
            response = client.raw_stream(
                compiled.sql, parameters, query_settings, fmt="ArrowStream"
            )
            decoder = ArrowIpcDecoder(
                compiled.query_id, response.headers.get(_EXCEPTION_TAG_HEADER)
            )
            batches = peek(arrow_batches(decoder, response.stream(ARROW_CHUNK_BYTES)))
            schema = decoder.schema
            if schema is None:
                raise CompiledQueryError("internal", "invalid result", query_id=compiled.query_id)
        except Exception as exc:
            if response is not None:
                with suppress(Exception):
                    response.close()
            if monitor is not None:
                monitor.stop()
            stopped = terminal_error(compiled)
            if stopped is not None:
                raise stopped from None
            if isinstance(exc, CompiledQueryError):
                raise
            raise _driver_failure(exc, compiled, self._readonly_policy) from None

        def release() -> None:
            try:
                response.close()
            finally:
                if monitor is not None:
                    monitor.stop()

        return SyncBatchStream(
            compiled,
            batches,
            release=release,
            fail=lambda exc: _driver_failure(exc, compiled, self._readonly_policy),
            abandon=self._abandon(compiled),
            schema=schema,
        )

    def close(self) -> None:
        """Release the driver's connection pool when execution is complete."""

        closer = getattr(self._client, "close", None)
        if callable(closer):
            closer()
        control_closer = getattr(self._control_client, "close", None)
        if callable(control_closer):
            control_closer()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class AsyncClickHouseExecutor:
    """Native async driver path with bounded admission and server cancellation."""

    def __init__(
        self,
        client: _AsyncClient,
        control_client: _AsyncControlClient,
        *,
        max_concurrent: int = 8,
        readonly_policy: ReadonlyPolicy = "query",
    ) -> None:
        validate_readonly_policy(readonly_policy)
        self._client = client
        self._control_client = control_client
        self._semaphore = asyncio.Semaphore(_capacity(max_concurrent))
        self._closed = False
        self._readonly_policy = readonly_policy
        self._retries = KillRetries()
        self._cancels_on_close = cancels_on_close(client)

    async def _cancel_on_server(self, query_id: str) -> object:
        try:
            return await asyncio.wait_for(
                self._control_client.command(_KILL_QUERY, {"id": query_id}),
                timeout=_CONTROL_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

    def _release_slot_when_done(self, task: asyncio.Task[QueryRows]) -> None:
        self._semaphore.release()
        with suppress(asyncio.CancelledError, Exception):
            task.result()

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        query_task: asyncio.Task[QueryRows] | None = None
        try:
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
            parameters, query_settings = _wire(self._client, compiled, self._readonly_policy)

            async def query() -> QueryRows:
                try:
                    result = await self._client.query(
                        compiled.sql,
                        parameters,
                        query_settings,
                        use_none=True,
                        tz_mode="aware",
                        transport_settings={},
                    )
                except Exception as exc:
                    # run_with_policy gives a cancellation or deadline precedence.
                    raise _driver_failure(exc, compiled, self._readonly_policy) from None
                return decode_result(result, compiled.query_id)

            query_task = asyncio.create_task(query())
            running = query_task
            # When the server cancels a query whose request closed, the end of
            # the driver call is the end of the query, so retries stop there.
            # Otherwise a query registered after the first KILL can only be
            # stopped by asking again, until the server's own time limit.
            return await run_with_policy(
                query_task,
                compiled,
                self._cancel_on_server,
                pending=(lambda: not running.done()) if self._cancels_on_close else None,
                retries=self._retries,
            )
        finally:
            if query_task is None:
                self._semaphore.release()
            elif query_task.done():
                self._release_slot_when_done(query_task)
            else:
                query_task.add_done_callback(self._release_slot_when_done)

    async def _open_stream(
        self,
        compiled: CompiledQuery,
        open_context: Callable[[dict[str, object], dict[str, int | str]], Awaitable[Any]],
        build: Callable[[Any], Awaitable[AsyncBatchStream[_B]]],
    ) -> AsyncBatchStream[_B]:
        """Admit, open and wrap one stream; the slot stays held until it closes."""

        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        handed_off = False
        try:
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
            parameters, query_settings = _wire(
                self._client, compiled, self._readonly_policy, stream=True
            )

            async def opened() -> Any:
                try:
                    context = await open_context(parameters, query_settings)
                    await context.__aenter__()
                except Exception as exc:
                    raise _driver_failure(exc, compiled, self._readonly_policy) from None
                return context

            opening = asyncio.ensure_future(opened())
            try:
                context = await run_with_policy(
                    opening, compiled, self._cancel_on_server, retries=self._retries
                )
            except BaseException:
                # A deadline or cancellation can land as the open completes:
                # the stream it opened anyway is closed here.
                if opening.done() and not opening.cancelled() and opening.exception() is None:
                    with suppress(Exception):
                        await opening.result().__aexit__(None, None, None)
                raise

            async def built() -> AsyncBatchStream[_B]:
                # Building can read the first batch (an Arrow schema), so it
                # waits under the same deadline and cancellation as any batch.
                try:
                    return await build(context)
                except CompiledQueryError:
                    raise
                except Exception as exc:
                    raise _driver_failure(exc, compiled, self._readonly_policy) from None

            try:
                stream = await run_with_policy(
                    built(), compiled, self._cancel_on_server, retries=self._retries
                )
            except BaseException:
                with suppress(Exception):
                    await context.__aexit__(None, None, None)
                raise
            handed_off = True
            return stream
        finally:
            if not handed_off:
                self._semaphore.release()

    def _stream_release(self, context: Any) -> Callable[[], Awaitable[None]]:
        async def release() -> None:
            try:
                await context.__aexit__(None, None, None)
            finally:
                self._semaphore.release()

        return release

    async def stream(self, compiled: CompiledQuery) -> AsyncBatchStream[QueryRows]:
        """Run *compiled* and hand its rows over block by block; close the stream to stop it."""

        client = cast(_AsyncStreamingClient, _streaming(self._client))

        async def open_context(
            parameters: dict[str, object], settings: dict[str, int | str]
        ) -> Any:
            return await client.query_row_block_stream(
                compiled.sql,
                parameters,
                settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={},
            )

        async def build(context: Any) -> AsyncBatchStream[QueryRows]:
            columns = decode_columns(context.source.column_names, compiled.query_id)
            return AsyncBatchStream(
                compiled,
                _async_row_blocks(context, columns, compiled.query_id),
                release=self._stream_release(context),
                fail=lambda exc: _driver_failure(exc, compiled, self._readonly_policy),
                cancel_on_server=self._cancel_on_server,
                retries=self._retries,
                columns=columns,
            )

        return await self._open_stream(compiled, open_context, build)

    async def stream_arrow(self, compiled: CompiledQuery) -> AsyncBatchStream[pa.RecordBatch]:
        """Run *compiled* and hand its result over as Arrow batches; see the sync executor."""

        client = cast(_AsyncStreamingClient, _streaming(self._client))
        decoder = ArrowIpcDecoder(compiled.query_id)

        async def open_context(
            parameters: dict[str, object], settings: dict[str, int | str]
        ) -> Any:
            return await client.raw_stream(compiled.sql, parameters, settings, fmt="ArrowStream")

        async def build(context: Any) -> AsyncBatchStream[pa.RecordBatch]:
            # The async driver hides the response headers; the block names its own tag.
            batches = await apeek(async_arrow_batches(decoder, aiter(context)))
            if decoder.schema is None:
                raise CompiledQueryError("internal", "invalid result", query_id=compiled.query_id)
            return AsyncBatchStream(
                compiled,
                batches,
                release=self._stream_release(context),
                fail=lambda exc: _driver_failure(exc, compiled, self._readonly_policy),
                cancel_on_server=self._cancel_on_server,
                retries=self._retries,
                schema=decoder.schema,
            )

        return await self._open_stream(compiled, open_context, build)

    async def aclose(self) -> None:
        """Stop pending KILL retries, then close the driver and control connection."""

        self._closed = True
        await self._retries.close()
        for client in (self._client, self._control_client):
            closer = getattr(client, "close", None)
            if callable(closer):
                await cast(Awaitable[object], closer())

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()


def _retrieve_outcome(done: asyncio.Future[Any]) -> None:
    if not done.cancelled():
        done.exception()


class AsyncFromSyncClickHouseExecutor:
    """Bounded worker bridge for applications with a synchronous driver client."""

    def __init__(
        self,
        client: _SyncClient,
        control_client: _SyncControlClient,
        *,
        max_concurrent: int = 4,
        readonly_policy: ReadonlyPolicy = "query",
    ) -> None:
        capacity = _capacity(max_concurrent)
        self._sync = ClickHouseExecutor(client, readonly_policy=readonly_policy)
        self._control = control_client
        self._workers = ThreadPoolExecutor(
            max_workers=capacity, thread_name_prefix="hypequery-query"
        )
        self._control_worker = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="hypequery-kill"
        )
        self._semaphore = asyncio.Semaphore(capacity)
        self._closed = False
        self._retries = KillRetries()

    async def _cancel_on_server(self, query_id: str) -> object:
        loop = asyncio.get_running_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(
                    self._control_worker,
                    self._control.command,
                    _KILL_QUERY,
                    {"id": query_id},
                ),
                timeout=_CONTROL_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

    def _release_slot_from_worker(self, loop: asyncio.AbstractEventLoop) -> None:
        # Application shutdown may close the loop before a blocked driver worker
        # returns; no further admission is possible in that loop.
        with suppress(RuntimeError):
            loop.call_soon_threadsafe(self._semaphore.release)

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        submitted = False
        try:
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
            loop = asyncio.get_running_loop()
            future = self._workers.submit(self._sync.execute, compiled)
            submitted = True
            work = asyncio.wrap_future(future)
            # A caller that gave up on the query (cancellation, deadline) never
            # reads the worker's outcome; mark it retrieved so asyncio does not
            # log the abandoned exception at garbage collection.
            work.add_done_callback(_retrieve_outcome)
            # The blocking driver call cannot be interrupted; the bridge knows
            # when it returns, so server cancellation can be retried until then.
            return await run_with_policy(
                work,
                compiled,
                self._cancel_on_server,
                pending=lambda: not future.done(),
                retries=self._retries,
            )
        finally:
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
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        except BaseException:
            self._semaphore.release()
            raise
        return await open_threaded(
            compiled,
            self._workers,
            open_sync,
            release_slot=lambda: self._release_slot_from_worker(loop),
            cancel_on_server=self._cancel_on_server,
            retries=self._retries,
        )

    async def stream(self, compiled: CompiledQuery) -> ThreadedBatchStream[QueryRows]:
        """Stream *compiled*'s rows from a worker thread; the slot is held until it closes."""

        return await self._open_threaded(compiled, lambda: self._sync.stream(compiled))

    async def stream_arrow(self, compiled: CompiledQuery) -> ThreadedBatchStream[pa.RecordBatch]:
        """Stream *compiled* as Arrow record batches from a worker thread."""

        require_pyarrow()
        return await self._open_threaded(compiled, lambda: self._sync.stream_arrow(compiled))

    def close(self) -> None:
        """Stop admitting new work, release both worker pools, close the clients.

        For shutdown without an event loop (``atexit``, a WSGI process). It does
        not wait: a query still running on a worker fails as its client
        closes. Prefer :meth:`aclose` where a loop is available.
        """

        self._closed = True
        self._workers.shutdown(wait=False, cancel_futures=True)
        self._control_worker.shutdown(wait=False, cancel_futures=True)
        closer = getattr(self._control, "close", None)
        try:
            self._sync.close()
        finally:
            if callable(closer):
                closer()

    async def aclose(self) -> None:
        """Wait for workers, then close the supplied driver clients.

        The control worker stays up until every query worker has returned: a
        cancellation retry may still need it to stop a query that registered
        on the server after the first KILL, and shutting it down first would
        leave that query running until ``max_execution_time``.
        """

        self._closed = True
        self._workers.shutdown(wait=False, cancel_futures=True)
        await asyncio.to_thread(self._workers.shutdown, wait=True)
        # Every driver call has returned, so no retry has anything left to stop.
        await self._retries.close()
        self._control_worker.shutdown(wait=False, cancel_futures=True)
        await asyncio.to_thread(self._control_worker.shutdown, wait=True)
        closer = getattr(self._control, "close", None)
        try:
            await asyncio.to_thread(self._sync.close)
        finally:
            if callable(closer):
                await asyncio.to_thread(closer)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()


def _connect_sync(connection: ClickHouseConnection) -> tuple[_SyncClient, _SyncControlClient]:
    """The query and control driver clients for *connection*."""

    try:
        from clickhouse_connect import get_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Install "hypequery[clickhouse]" to use ClickHouse execution.',
            name=exc.name,
        ) from exc
    client = None
    try:
        client = get_client(**_client_kwargs(connection))
        control_client = get_client(**_control_kwargs(connection))
    except Exception as exc:
        if client is not None:
            client.close()
        raise safe_driver_error(exc, "") from None
    return cast(_SyncClient, client), cast(_SyncControlClient, control_client)


def create_clickhouse_executor(connection: ClickHouseConnection) -> ClickHouseExecutor:
    """Connect on demand. Install ``hypequery[clickhouse]`` first."""

    client, control_client = _connect_sync(connection)
    return ClickHouseExecutor(
        client,
        readonly_policy=connection.readonly_policy,
        control_client=control_client,
    )


def create_async_from_sync_clickhouse_executor(
    connection: ClickHouseConnection, *, max_concurrent: int = 4
) -> AsyncFromSyncClickHouseExecutor:
    """An async executor that runs the sync driver on bounded worker threads.

    Needs only ``hypequery[clickhouse]``: there is no aiohttp session, so
    nothing leaks when an application (Django, Flask) has no shutdown hook to
    close it, and :meth:`AsyncFromSyncClickHouseExecutor.close` works without
    an event loop. Its admission queue belongs to the event loop it first
    waits on, so share one across requests only where they share a loop, as
    under an ASGI server.
    """

    client, control_client = _connect_sync(connection)
    return AsyncFromSyncClickHouseExecutor(
        client,
        control_client,
        max_concurrent=max_concurrent,
        readonly_policy=connection.readonly_policy,
    )


async def create_async_clickhouse_executor(
    connection: ClickHouseConnection,
) -> AsyncClickHouseExecutor:
    """Connect on demand. Install ``hypequery[clickhouse-async]`` first."""

    try:
        from clickhouse_connect.driver import create_async_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Install "hypequery[clickhouse-async]" to use async ClickHouse execution.',
            name=exc.name,
        ) from exc
    # The driver imports without aiohttp and only fails when a client is
    # created, where the error would be reported as an opaque internal one.
    if find_spec("aiohttp") is None:
        raise ModuleNotFoundError(
            'Install "hypequery[clickhouse-async]" to use async ClickHouse execution.',
            name="aiohttp",
        )
    client = None
    try:
        client = await create_async_client(**_client_kwargs(connection))
        control_client = await create_async_client(**_control_kwargs(connection))
    except Exception as exc:
        if client is not None:
            await client.close()
        raise safe_driver_error(exc, "") from None
    return AsyncClickHouseExecutor(
        cast(_AsyncClient, client),
        cast(_AsyncControlClient, control_client),
        readonly_policy=connection.readonly_policy,
    )
