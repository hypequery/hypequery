"""Sync and async ClickHouse execution of compiled queries."""

from __future__ import annotations

import asyncio
import os
import threading
from collections.abc import Awaitable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from types import TracebackType
from typing import Protocol, Self, TypedDict, cast

from hypequery.datasets.planner import SETTING_DEFINITIONS, CompiledQuery, CompiledQueryError

from .cancellation import acquire_slot, run_with_policy, terminal_error
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
from .utils.connection_env import connection_fields


@dataclass(frozen=True, slots=True)
class ClickHouseConnection:
    """Explicit connection fields and readonly policy; the password is never logged."""

    host: str = "localhost"
    port: int | None = None
    database: str = "default"
    username: str = "default"
    password: str = field(default="", repr=False)
    secure: bool = False
    readonly_policy: ReadonlyPolicy = "query"

    def __post_init__(self) -> None:
        validate_readonly_policy(self.readonly_policy)

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        readonly_policy: ReadonlyPolicy = "query",
    ) -> Self:
        """Read ``CLICKHOUSE_HOST``, ``_PORT``, ``_DATABASE``, ``_USERNAME``,
        ``_PASSWORD`` and ``_SECURE``, defaulting to a local server.

        An unset port lets the driver choose 8123, or 8443 when secure.
        """

        fields = connection_fields(os.environ if environ is None else environ)
        return cls(**fields, readonly_policy=readonly_policy)


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
    host: str
    port: int | None
    database: str
    username: str
    password: str
    secure: bool


def _client_kwargs(connection: ClickHouseConnection) -> _ClientKwargs:
    """Connection fields shared by the query and cancellation-control clients."""

    return {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": connection.password,
        "secure": connection.secure,
    }


#: The control connection only sends KILL QUERY, so it fails fast.
_CONTROL_TIMEOUT_SECONDS = 2


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
        with self._control_lock:
            return self._control_client.command(_KILL_QUERY, {"id": query_id})

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
            return await run_with_policy(query_task, compiled, self._cancel_on_server)
        finally:
            if query_task is None:
                self._semaphore.release()
            elif query_task.done():
                self._release_slot_when_done(query_task)
            else:
                query_task.add_done_callback(self._release_slot_when_done)

    async def aclose(self) -> None:
        """Close the driver and dedicated control connection."""

        self._closed = True
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
            return await run_with_policy(work, compiled, self._cancel_on_server)
        finally:
            if submitted and not future.done():
                future.add_done_callback(lambda _: self._release_slot_from_worker(loop))
            else:
                self._semaphore.release()

    def close(self) -> None:
        """Stop admitting new work and release both bounded worker pools."""

        self._closed = True
        self._workers.shutdown(wait=False, cancel_futures=True)
        self._control_worker.shutdown(wait=False, cancel_futures=True)

    async def aclose(self) -> None:
        """Wait for workers, then close the supplied driver clients."""

        self.close()
        await asyncio.to_thread(self._workers.shutdown, wait=True)
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


def create_clickhouse_executor(connection: ClickHouseConnection) -> ClickHouseExecutor:
    """Connect on demand. Install ``hypequery[clickhouse]`` first."""

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
        control_client = get_client(
            **_client_kwargs(connection), send_receive_timeout=_CONTROL_TIMEOUT_SECONDS
        )
    except Exception as exc:
        if client is not None:
            client.close()
        raise safe_driver_error(exc, "") from None
    return ClickHouseExecutor(
        cast(_SyncClient, client),
        readonly_policy=connection.readonly_policy,
        control_client=cast(_SyncControlClient, control_client),
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
    client = None
    try:
        client = await create_async_client(**_client_kwargs(connection))
        control_client = await create_async_client(
            **_client_kwargs(connection), send_receive_timeout=_CONTROL_TIMEOUT_SECONDS
        )
    except Exception as exc:
        if client is not None:
            await client.close()
        raise safe_driver_error(exc, "") from None
    return AsyncClickHouseExecutor(
        cast(_AsyncClient, client),
        cast(_AsyncControlClient, control_client),
        readonly_policy=connection.readonly_policy,
    )
