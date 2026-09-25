"""Sync and async ClickHouse execution of compiled queries."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

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
        settings: dict[str, int],
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
        settings: dict[str, int],
        *,
        use_none: bool,
        tz_mode: str,
        transport_settings: dict[str, str],
    ) -> DriverResult: ...


def _query_arguments(compiled: CompiledQuery) -> tuple[dict[str, object], dict[str, int]]:
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
        try:
            result = self._client.query(
                compiled.sql,
                parameters,
                settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={"query_id": compiled.query_id},
            )
        except Exception as exc:
            raise safe_driver_error(exc, compiled.query_id) from None
        return decode_result(result, compiled.query_id)


class AsyncClickHouseExecutor:
    """Async driver path; cancellation propagation is added in PYC-02."""

    def __init__(self, client: _AsyncClient) -> None:
        self._client = client

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        parameters, settings = _query_arguments(compiled)
        try:
            result = await self._client.query(
                compiled.sql,
                parameters,
                settings,
                use_none=True,
                tz_mode="aware",
                transport_settings={"query_id": compiled.query_id},
            )
        except Exception as exc:
            raise safe_driver_error(exc, compiled.query_id) from None
        return decode_result(result, compiled.query_id)


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
    try:
        client = await create_async_client(
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=connection.password,
            secure=connection.secure,
        )
    except Exception as exc:
        raise safe_driver_error(exc, "") from None
    return AsyncClickHouseExecutor(cast(_AsyncClient, client))
