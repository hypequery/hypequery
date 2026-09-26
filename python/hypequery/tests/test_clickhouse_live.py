"""Live parameter matrix; CI supplies a ClickHouse service."""

from __future__ import annotations

import asyncio
import os
import threading
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline, TypedParameter
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
        try:
            return (await executor.execute(_query("async ' \x00", "String"))).rows
        finally:
            await executor.aclose()

    assert asyncio.run(run()) == (("async ' \x00",),)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize("cancel_by", ["signal", "deadline"])
def test_live_async_cancellation_stops_server_query(cancel_by: str) -> None:
    async def run() -> None:
        connection = _connection()
        executor = await create_async_clickhouse_executor(connection)
        observer = await create_async_clickhouse_executor(connection)
        signal = threading.Event()
        compiled = CompiledQuery(
            "SELECT sleep(3) AS value",
            {},
            deadline=Deadline.after(0.5 if cancel_by == "deadline" else 10),
            cancellation=signal,
        )
        try:
            task = asyncio.create_task(executor.execute(compiled))
            active = CompiledQuery(
                "SELECT count() AS value FROM system.processes WHERE query_id = {p0:String}",
                {"p0": TypedParameter("p0", "String", compiled.query_id)},
            )
            for _ in range(100):
                if (await observer.execute(active)).rows == ((1,),):
                    break
                await asyncio.sleep(0.02)
            else:
                pytest.fail("query did not appear in system.processes")
            if cancel_by == "signal":
                signal.set()
            with pytest.raises(CompiledQueryError) as exc:
                await task
            assert exc.value.category == (
                "aborted" if cancel_by == "signal" else "deadline-exceeded"
            )
            assert (await observer.execute(active)).rows == ((0,),)
        finally:
            await executor.aclose()
            await observer.aclose()

    asyncio.run(run())
