"""Live parameter matrix; CI supplies a ClickHouse service."""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from hypequery.datasets.planner import CompiledQuery, TypedParameter
from hypequery.execution import (
    ClickHouseConnection,
    create_async_clickhouse_executor,
    create_clickhouse_executor,
)


def _connection() -> ClickHouseConnection:
    return ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=8123,
        database="test_db",
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )


def _query(value: object, kind: str) -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
    )


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize(
    ("value", "kind", "expected"),
    [
        ("quote ' and \\ and \x00", "String", "quote ' and \\ and \x00"),
        (2**63 - 1, "Int64", 2**63 - 1),
        (2**64 - 1, "UInt64", 2**64 - 1),
        (Decimal("123456789.012345678"), "Decimal(27,9)", "123456789.012345678"),
        (
            datetime(2026, 10, 25, 1, 30, tzinfo=UTC),
            "DateTime64(3)",
            "2026-10-25T01:30:00+00:00",
        ),
    ],
)
def test_live_sync_parameters(value: object, kind: str, expected: object) -> None:
    executor = create_clickhouse_executor(_connection())
    result = executor.execute(_query(value, kind))
    assert result.rows == ((expected,),)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_async_parameters() -> None:
    async def run() -> object:
        executor = await create_async_clickhouse_executor(_connection())
        return (await executor.execute(_query("async ' \x00", "String"))).rows

    assert asyncio.run(run()) == (("async ' \x00",),)
