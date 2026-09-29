"""Live parameter matrix; CI supplies a ClickHouse service."""

from __future__ import annotations

import asyncio
import os
import threading
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    MemoryCacheStore,
    ResultCache,
    count,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    eq,
    measure,
)
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


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_dataset_clients_return_the_same_rows() -> None:
    one = Dataset(
        name="one",
        source="system.one",
        dimensions={"dummy": dimension("number")},
        measures={"rows": measure(count("dummy"))},
    )
    query = DatasetQuery(dimensions=("dummy",), measures=("rows",), filters=(eq("dummy", 0),))
    expected = ({"dummy": 0, "rows": 1},)

    executor = create_clickhouse_executor(_connection())
    try:
        assert create_dataset_client(executor=executor).execute(one, query).data == expected
        cache = ResultCache(
            store=MemoryCacheStore(),
            project="live",
            environment="ci",
            ttl_seconds=60,
        )
        cached = create_dataset_client(executor=executor, cache=cache)
        first, second = cached.execute(one, query), cached.execute(one, query)
        assert (first.meta.cache, second.meta.cache) == ("miss", "hit")
        assert first.data == second.data == expected
    finally:
        executor.close()

    async def run() -> object:
        async_executor = await create_async_clickhouse_executor(_connection())
        try:
            client = create_async_dataset_client(executor=async_executor)
            return (await client.execute(one, query)).data
        finally:
            await async_executor.aclose()

    assert asyncio.run(run()) == expected


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize("level", [1, 2])
def test_live_readonly_users_can_query(level: int) -> None:
    # Before settings_access, every query failed for both: the planner's
    # readonly = 1 is refused by a readonly = 2 user, and its limits by a
    # readonly = 1 user whose profile does not match them exactly.
    from clickhouse_connect import get_client

    connection = _connection()
    username = f"hypequery_readonly_{level}"
    password = f"{connection.password}_readonly_{level}"
    admin = get_client(
        host=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
    )
    try:
        admin.command(f"DROP USER IF EXISTS {username}")
        admin.command(
            f"CREATE USER {username} IDENTIFIED BY '{password}' SETTINGS readonly = {level}"
        )
        admin.command(f"GRANT SELECT ON {connection.database}.* TO {username}")
        reader = create_clickhouse_executor(
            replace(connection, username=username, password=password)
        )
        try:
            assert reader.execute(_query(7, "UInt8")).rows == ((7,),)
        finally:
            reader.close()
    finally:
        admin.command(f"DROP USER IF EXISTS {username}")
        admin.close()
