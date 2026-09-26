from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import cast

import pytest
from clickhouse_connect.driver.binding import bind_query
from clickhouse_connect.driver.exceptions import OperationalError, ProgrammingError

from hypequery.datasets.planner import (
    CompiledQuery,
    CompiledQueryError,
    QuerySettings,
    TypedParameter,
)
from hypequery.execution import (
    AsyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
)
from hypequery.execution.results import DriverResult, decode_result


@dataclass
class Result:
    column_names: tuple[str, ...]
    result_rows: list[tuple[object, ...]]


class SyncClient:
    def __init__(self, result: Result | Exception) -> None:
        self.result = result
        self.calls: list[tuple[object, ...]] = []

    def query(self, *args: object, **kwargs: object) -> DriverResult:
        self.calls.append((args, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return cast(DriverResult, self.result)


class AsyncClient(SyncClient):
    async def query(self, *args: object, **kwargs: object) -> DriverResult:  # type: ignore[override]
        return super().query(*args, **kwargs)


def compiled(value: object = "a'b\x00c", kind: str = "String") -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
    )


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        ("a'b\x00c", "String"),
        (2**63 - 1, "Int64"),
        (2**64 - 1, "UInt64"),
        (Decimal("123456789.012345678"), "Decimal(27,9)"),
        (datetime(2026, 10, 25, 1, 30, tzinfo=UTC), "DateTime64(3)"),
    ],
)
def test_driver_uses_server_parameter_binding(value: object, kind: str) -> None:
    query = compiled(value, kind)
    client = SyncClient(Result(("value",), [("ok",)]))
    result = ClickHouseExecutor(client).execute(query)
    assert result.named_rows() == ({"value": "ok"},)
    args, kwargs = cast(tuple[tuple[object, ...], dict[str, object]], client.calls[0])
    assert args[0] == query.sql
    assert args[1] == {"p0": value}
    assert kwargs["transport_settings"] == {}
    assert cast(dict[str, object], args[2])["query_id"] == query.query_id
    assert kwargs["use_none"] is True
    assert kwargs["tz_mode"] == "aware"
    wire_sql, bound = bind_query(query.sql, cast(dict[str, object], args[1]))
    assert wire_sql == query.sql
    assert "param_p0" in bound
    assert str(value) not in wire_sql


def test_async_query_uses_same_boundary() -> None:
    query = compiled()
    client = AsyncClient(Result(("value",), [("ok",)]))

    class Control:
        async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            return "finished"

    result = asyncio.run(AsyncClickHouseExecutor(client, Control()).execute(query))
    assert result.named_rows() == ({"value": "ok"},)
    assert client.calls


@pytest.mark.parametrize(
    "query",
    [
        CompiledQuery("SELECT 1", {"p0": TypedParameter("p0", "String", "secret")}),
        CompiledQuery("SELECT {p0:String}", {"p0": TypedParameter("p0", "Int64", 3)}),
        CompiledQuery("SELECT {p0:String}", {"p0": TypedParameter("p0", "String", object())}),
        CompiledQuery("DELETE FROM t", {}),
        CompiledQuery("SELECT 1", {}, settings=QuerySettings({"readonly": 0})),
    ],
)
def test_invalid_query_never_reaches_driver(query: CompiledQuery) -> None:
    client = SyncClient(Result((), []))
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(client).execute(query)
    assert exc.value.category == "internal"
    assert client.calls == []


def test_result_codec_is_closed() -> None:
    query = compiled()
    result = Result(
        ("number", "amount", "day", "at", "empty"),
        [(2**63, Decimal("1.25"), date(2026, 1, 2), datetime(2026, 1, 2, tzinfo=UTC), None)],
    )
    decoded = decode_result(cast(DriverResult, result), query.query_id)
    assert decoded.rows == ((2**63, "1.25", "2026-01-02", "2026-01-02T00:00:00+00:00", None),)
    with pytest.raises(CompiledQueryError):
        decode_result(cast(DriverResult, Result(("x",), [(object(),)])), query.query_id)
    with pytest.raises(CompiledQueryError):
        decode_result(cast(DriverResult, Result(("x", "x"), [])), query.query_id)


@pytest.mark.parametrize(
    ("failure", "category"),
    [
        (OperationalError("password=secret value='secret'"), "unavailable"),
        (ProgrammingError("SELECT 'secret'"), "internal"),
        (ProgrammingError("secret", name="NOT_ENOUGH_PRIVILEGES"), "forbidden"),
    ],
)
def test_driver_error_is_redacted(failure: Exception, category: str) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(SyncClient(failure)).execute(compiled())
    assert exc.value.category == category
    assert "secret" not in str(exc.value)
    assert "SELECT" not in str(exc.value)


def test_connection_repr_redacts_password() -> None:
    marker = "private-token"
    connection = ClickHouseConnection(password=marker)
    assert "secret" not in repr(connection)
