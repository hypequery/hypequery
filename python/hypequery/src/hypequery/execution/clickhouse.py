"""Sync and async ClickHouse execution of compiled queries."""

from __future__ import annotations

import asyncio
import os
import threading
from collections.abc import Awaitable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from importlib.util import find_spec
from types import TracebackType
from typing import Any, Protocol, Self, TypedDict, cast

from hypequery.datasets.planner import SETTING_DEFINITIONS, CompiledQuery, CompiledQueryError

from .cancellation import KillRetries, acquire_slot, run_with_policy, terminal_error
from .errors import safe_driver_error
from .parameters import bound_parameters
from .readonly_settings import (
    ReadonlyPolicy,
    readonly_setting_error,
    validate_readonly_policy,
    wire_settings,
)
from .results import DriverResult, QueryRows, decode_result
from .sync_cancellation import SyncCancellationMonitor
from .utils.close_cancellation import cancels_on_close
from .utils.connection_env import connection_fields, control_fields
from .utils.connection_url import url_fields


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


class _SyncControlClient(Protocol):
    def command(self, cmd: str, parameters: dict[str, str]) -> object: ...


class _AsyncControlClient(Protocol):
    async def command(self, cmd: str, parameters: dict[str, str]) -> object: ...


_KILL_QUERY = "KILL QUERY WHERE query_id = {id:String} SYNC"


def _capacity(value: int) -> int:
    if type(value) is not int or not 1 <= value <= 128:
        raise ValueError("max_concurrent must be an integer between 1 and 128")
    return value


def _query_arguments(compiled: CompiledQuery) -> tuple[dict[str, object], dict[str, int]]:
    reason = terminal_error(compiled)
    if reason is not None:
        raise reason
    parameters = bound_parameters(compiled)
    # QuerySettings is a dataclass and can be constructed directly; recheck it
    # at the adapter boundary before allowing a setting onto the wire.
    settings = dict(compiled.settings.values)
    if set(settings) != set(SETTING_DEFINITIONS) or any(
        type(value) is not int
        or not SETTING_DEFINITIONS[name].minimum <= value <= SETTING_DEFINITIONS[name].maximum
        for name, value in settings.items()
    ):
        raise CompiledQueryError("internal", "invalid query settings", query_id=compiled.query_id)
    return parameters, settings


def _driver_failure(
    exc: Exception, compiled: CompiledQuery, policy: ReadonlyPolicy
) -> CompiledQueryError:
    """The public error for a failed driver call, never the driver's own text.

    Readonly guidance outranks the generic mapping because it is the one
    failure an operator can fix from the message alone.
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

    def _cancel_on_server(self, query_id: str) -> object:
        if self._control_client is None:
            return None
        try:
            with self._control_lock:
                return self._control_client.command(_KILL_QUERY, {"id": query_id})
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        parameters, settings = _query_arguments(compiled)
        selected = wire_settings(self._client, settings, self._readonly_policy, compiled.query_id)
        # The driver's settings path puts query_id in HTTP parameters.
        # transport_settings becomes headers, which ClickHouse ignores here.
        query_settings: dict[str, int | str] = {**selected, "query_id": compiled.query_id}
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
            parameters, settings = _query_arguments(compiled)
            selected = wire_settings(
                self._client, settings, self._readonly_policy, compiled.query_id
            )
            query_settings: dict[str, int | str] = {
                **selected,
                "query_id": compiled.query_id,
            }

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
