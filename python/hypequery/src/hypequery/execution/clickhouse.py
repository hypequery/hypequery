"""Sync and async ClickHouse execution of compiled queries."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Protocol, cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

from .cancellation import acquire_slot, run_with_policy
from .errors import safe_driver_error
from .parameters import bound_parameters
from .results import DriverResult, QueryRows, decode_result


@dataclass(frozen=True, slots=True)
class ClickHouseConnection:
    """Explicit connection fields; the password is absent from repr and logs."""

    host: str = "localhost"
    port: int | None = None
    database: str = "default"
    username: str = "default"
    password: str = field(default="", repr=False)
    secure: bool = False


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
    if compiled.cancellation is not None and compiled.cancellation.is_set():
        raise CompiledQueryError("aborted", "The query was cancelled.", query_id=compiled.query_id)
    if compiled.deadline is not None and compiled.deadline.expired():
        raise CompiledQueryError(
            "deadline-exceeded", "The query timed out.", query_id=compiled.query_id
        )
    parameters = bound_parameters(compiled)
    # QuerySettings is a dataclass and can be constructed directly; recheck it
    # at the adapter boundary before allowing a setting onto the wire.
    from hypequery.datasets.planner import SETTING_DEFINITIONS

    settings = dict(compiled.settings.values)
    if set(settings) != set(SETTING_DEFINITIONS) or any(
        type(value) is not int
        or not SETTING_DEFINITIONS[name].minimum <= value <= SETTING_DEFINITIONS[name].maximum
        for name, value in settings.items()
    ):
        raise CompiledQueryError("internal", "invalid query settings", query_id=compiled.query_id)
    return parameters, settings


class ClickHouseExecutor:
    """Execute a trusted compiled SELECT with native server parameters."""

    def __init__(self, client: _SyncClient) -> None:
        self._client = client

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        parameters, settings = _query_arguments(compiled)
        # The driver's settings path puts query_id in HTTP parameters.
        # transport_settings becomes headers, which ClickHouse ignores here.
        wire_settings: dict[str, int | str] = {**settings, "query_id": compiled.query_id}
        try:
            result = self._client.query(
                compiled.sql,
                parameters,
                wire_settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={},
            )
        except Exception as exc:
            raise safe_driver_error(exc, compiled.query_id) from None
        return decode_result(result, compiled.query_id)


class AsyncClickHouseExecutor:
    """Native async driver path with bounded admission and server cancellation."""

    def __init__(
        self,
        client: _AsyncClient,
        control_client: _AsyncControlClient | None = None,
        *,
        max_concurrent: int = 8,
    ) -> None:
        self._client = client
        self._control_client = control_client
        self._semaphore = asyncio.Semaphore(_capacity(max_concurrent))
        self._closed = False

    async def _cancel_on_server(self, query_id: str) -> object:
        if self._control_client is None:
            raise CompiledQueryError("unavailable", "", query_id=query_id)
        try:
            return await asyncio.wait_for(
                self._control_client.command(_KILL_QUERY, {"id": query_id}), timeout=2.0
            )
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        if self._closed:
            raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
        await acquire_slot(self._semaphore, compiled)
        try:
            if self._closed:
                raise CompiledQueryError("unavailable", "", query_id=compiled.query_id)
            parameters, settings = _query_arguments(compiled)
            wire_settings: dict[str, int | str] = {**settings, "query_id": compiled.query_id}

            async def query() -> QueryRows:
                try:
                    result = await self._client.query(
                        compiled.sql,
                        parameters,
                        wire_settings,
                        use_none=True,
                        tz_mode="aware",
                        transport_settings={},
                    )
                except Exception as exc:
                    raise safe_driver_error(exc, compiled.query_id) from None
                return decode_result(result, compiled.query_id)

            return await run_with_policy(query(), compiled, self._cancel_on_server)
        finally:
            self._semaphore.release()

    async def aclose(self) -> None:
        """Close the driver and dedicated control connection."""

        self._closed = True
        for client in (self._client, self._control_client):
            closer = getattr(client, "close", None)
            if callable(closer):
                await cast(Awaitable[object], closer())


class AsyncFromSyncClickHouseExecutor:
    """Bounded worker bridge for applications with a synchronous driver client."""

    def __init__(
        self,
        client: _SyncClient,
        control_client: _SyncControlClient,
        *,
        max_concurrent: int = 4,
    ) -> None:
        capacity = _capacity(max_concurrent)
        self._sync = ClickHouseExecutor(client)
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
            command = await asyncio.wait_for(
                loop.run_in_executor(
                    self._control_worker,
                    self._control.command,
                    _KILL_QUERY,
                    {"id": query_id},
                ),
                timeout=2.0,
            )
            return command
        except Exception as exc:
            raise safe_driver_error(exc, query_id) from None

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
                future.add_done_callback(
                    lambda _: loop.call_soon_threadsafe(self._semaphore.release)
                )
            else:
                self._semaphore.release()

    def close(self) -> None:
        """Stop admitting new work and release both bounded worker pools."""

        self._closed = True
        self._workers.shutdown(wait=False, cancel_futures=True)
        self._control_worker.shutdown(wait=False, cancel_futures=True)


def create_clickhouse_executor(connection: ClickHouseConnection) -> ClickHouseExecutor:
    """Connect on demand. Install ``hypequery[clickhouse]`` first."""

    try:
        from clickhouse_connect import get_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Install "hypequery[clickhouse]" to use ClickHouse execution.'
        ) from exc
    try:
        client = get_client(
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=connection.password,
            secure=connection.secure,
        )
    except Exception as exc:
        raise safe_driver_error(exc, "") from None
    return ClickHouseExecutor(cast(_SyncClient, client))


async def create_async_clickhouse_executor(
    connection: ClickHouseConnection,
) -> AsyncClickHouseExecutor:
    """Connect on demand. Install ``hypequery[clickhouse-async]`` first."""

    try:
        from clickhouse_connect.driver import create_async_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Install "hypequery[clickhouse-async]" to use async ClickHouse execution.'
        ) from exc
    client = None
    try:
        client = await create_async_client(
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=connection.password,
            secure=connection.secure,
        )
        control_client = await create_async_client(
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=connection.password,
            secure=connection.secure,
        )
    except Exception as exc:
        if client is not None:
            await client.close()
        raise safe_driver_error(exc, "") from None
    return AsyncClickHouseExecutor(
        cast(_AsyncClient, client), cast(_AsyncControlClient, control_client)
    )
