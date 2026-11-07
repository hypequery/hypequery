"""Streams against real engines: every ClickHouse executor and both chDB executors.

The ClickHouse tests need ``HYPEQUERY_TEST_CLICKHOUSE_HOST``; the chDB tests run
the embedded engine, which CI installs with every extra.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pyarrow as pa
import pytest

from hypequery.datasets import (
    CompiledQueryError,
    DatasetQuery,
    ExecutionContext,
    create_async_dataset_client,
    create_dataset_client,
    dataset,
    dimension,
    measure,
    tenant,
)
from hypequery.datasets.planner import query_settings
from hypequery.datasets.query_helpers import asc
from hypequery.execution import (
    ClickHouseConnection,
    create_async_chdb_executor,
    create_async_clickhouse_executor,
    create_async_from_sync_clickhouse_executor,
    create_chdb_executor,
    create_clickhouse_executor,
)

live_clickhouse = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)

DATABASE = "hq_streaming"
PORT = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))

sales = dataset(
    "sales",
    source="sales",
    tenant_key="tenant",
    dimensions={"status": dimension.string(), "customer": dimension.number()},
    measures={
        "revenue": measure.sum("amount"),
        "orders": measure.count("customer"),
        "buyers": measure.count_distinct("customer"),
    },
)

GROUPED = DatasetQuery(
    dimensions=("status", "customer"),
    measures=("revenue", "orders", "buyers"),
    order_by=(asc("status"), asc("customer")),
)
ACME = ExecutionContext(tenant=tenant("a"))
TABLE = (
    "CREATE TABLE {db}sales (tenant String, status String, customer UInt32, "
    "amount Decimal(18, 2)) ENGINE = MergeTree ORDER BY (tenant, customer)"
)
ROWS = (
    "INSERT INTO {db}sales SELECT if(number % 2 = 0, 'a', 'b'), "
    "['paid', 'open', 'void', 'refunded', 'held'][intDiv(number, 7) % 5 + 1], "
    "number % 1000, toDecimal64((number % 997) / 10, 2) FROM numbers(60000)"
)


def _connection() -> ClickHouseConnection:
    return ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=PORT,
        database=DATABASE,
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )


@pytest.fixture(scope="module")
def admin() -> Iterator[Any]:
    if "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ:
        pytest.skip("live ClickHouse service is not configured")
    import clickhouse_connect

    client = clickhouse_connect.get_client(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=PORT,
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    client.command(f"DROP DATABASE IF EXISTS {DATABASE}")
    client.command(f"CREATE DATABASE {DATABASE}")
    client.command(TABLE.format(db=f"{DATABASE}."))
    client.command(ROWS.format(db=f"{DATABASE}."))
    try:
        yield client
    finally:
        client.command(f"DROP DATABASE IF EXISTS {DATABASE}")
        client.close()


def _rows(stream: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [row for batch in stream for row in batch]
    return rows


def _arrow_as_rows(table: pa.Table) -> list[dict[str, Any]]:
    """Arrow's native values in execute's wire forms, for comparison."""

    rows: list[dict[str, Any]] = table.to_pylist()
    for row in rows:
        if isinstance(row["revenue"], Decimal):
            row["revenue"] = str(row["revenue"])
    return rows


# --- ClickHouse ----------------------------------------------------------------


@live_clickhouse
def test_sync_streams_match_execute(admin: Any) -> None:
    with create_clickhouse_executor(_connection()) as executor:
        client = create_dataset_client(executor=executor)
        executed = client.execute(sales, GROUPED, context=ACME)
        with client.stream(sales, GROUPED, context=ACME) as stream:
            streamed = _rows(stream)
        with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
            table = arrow.read_all()

    assert len(executed.data) == 2500
    assert streamed == list(executed.data)
    assert table.schema.field("revenue").type == pa.decimal128(38, 2)
    assert table.schema.field("orders").type == pa.uint64()
    assert _arrow_as_rows(table) == list(executed.data)


@live_clickhouse
def test_streams_are_tenant_scoped(admin: Any) -> None:
    with create_clickhouse_executor(_connection()) as executor:
        client = create_dataset_client(executor=executor).for_tenant(tenant("b"))
        with client.stream(sales, GROUPED) as stream:
            customers = {int(str(row["customer"])) for row in stream.rows()}
    assert len(customers) == 500
    assert all(customer % 2 == 1 for customer in customers)


@live_clickhouse
@pytest.mark.parametrize("arrow", [False, True])
def test_a_stream_past_max_result_rows_fails_as_too_large(admin: Any, arrow: bool) -> None:
    with create_clickhouse_executor(_connection()) as executor:
        client = create_dataset_client(
            executor=executor, settings=query_settings(max_result_rows=1000)
        )
        open_stream = client.stream_arrow if arrow else client.stream
        with (
            pytest.raises(CompiledQueryError) as raised,
            open_stream(sales, GROUPED, context=ACME) as stream,
        ):
            for _ in stream:
                pass
    assert raised.value.category == "too-large"


@live_clickhouse
def test_closing_a_stream_early_stops_the_query_on_the_server(admin: Any) -> None:
    query = DatasetQuery(dimensions=("customer",), measures=("orders",))
    with create_clickhouse_executor(_connection()) as executor:
        client = create_dataset_client(executor=executor)
        stream = client.stream(sales, query, context=ACME)
        with stream:
            next(iter(stream))
        query_id = stream.query_id
    for _ in range(40):
        running = admin.query(
            "SELECT count() FROM system.processes WHERE query_id = {id:String}",
            parameters={"id": query_id},
        ).result_rows[0][0]
        if running == 0:
            break
        time.sleep(0.05)
    assert running == 0


@live_clickhouse
def test_native_async_streams_match_execute(admin: Any) -> None:
    async def run() -> None:
        executor = await create_async_clickhouse_executor(_connection())
        async with executor:
            client = create_async_dataset_client(executor=executor)
            executed = await client.execute(sales, GROUPED, context=ACME)
            async with client.stream(sales, GROUPED, context=ACME) as stream:
                streamed = [row async for row in stream.rows()]
            async with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
                table = await arrow.read_all()
        assert streamed == list(executed.data)
        assert _arrow_as_rows(table) == list(executed.data)

    asyncio.run(run())


@live_clickhouse
def test_native_async_arrow_reports_a_mid_stream_overflow(admin: Any) -> None:
    async def run() -> None:
        executor = await create_async_clickhouse_executor(_connection())
        async with executor:
            client = create_async_dataset_client(
                executor=executor, settings=query_settings(max_result_rows=1000)
            )
            with pytest.raises(CompiledQueryError) as raised:  # noqa: PT012
                async with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
                    async for _ in arrow:
                        pass
            assert raised.value.category == "too-large"

    asyncio.run(run())


@live_clickhouse
def test_bridged_async_streams_match_execute(admin: Any) -> None:
    async def run() -> None:
        executor = create_async_from_sync_clickhouse_executor(_connection(), max_concurrent=1)
        async with executor:
            client = create_async_dataset_client(executor=executor)
            executed = await client.execute(sales, GROUPED, context=ACME)
            async with client.stream(sales, GROUPED, context=ACME) as stream:
                streamed = [row async for row in stream.rows()]
            async with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
                table = await arrow.read_all()
            # The single slot came back: another query runs.
            assert (await client.execute(sales, GROUPED, context=ACME)).data == executed.data
        assert streamed == list(executed.data)
        assert _arrow_as_rows(table) == list(executed.data)

    asyncio.run(run())


# --- chDB ---------------------------------------------------------------------


@pytest.fixture
def chdb_database() -> Iterator[str]:
    pytest.importorskip("chdb")
    database = f"hq_stream_{uuid.uuid4().hex[:8]}"
    with create_chdb_executor() as setup:
        connection = setup._connection
        connection.query(f"CREATE DATABASE {database}")
        connection.query(TABLE.format(db=f"{database}."))
        connection.query(ROWS.format(db=f"{database}."))
        yield database
        connection.query(f"DROP DATABASE {database}")


def test_chdb_streams_match_execute(chdb_database: str) -> None:
    with create_chdb_executor(database=chdb_database) as executor:
        client = create_dataset_client(executor=executor)
        executed = client.execute(sales, GROUPED, context=ACME)
        with client.stream(sales, GROUPED, context=ACME) as stream:
            streamed = _rows(stream)
        with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
            table = arrow.read_all()
        # The connection came back: a query after the streams runs.
        assert client.execute(sales, GROUPED, context=ACME).data == executed.data

    assert len(executed.data) == 2500
    assert streamed == list(executed.data)
    assert _arrow_as_rows(table) == list(executed.data)


def test_chdb_stream_closed_early_frees_the_connection(chdb_database: str) -> None:
    with create_chdb_executor(database=chdb_database) as executor:
        client = create_dataset_client(executor=executor)
        query = DatasetQuery(dimensions=("customer",), measures=("orders",))
        with client.stream(sales, query, context=ACME) as stream:
            next(iter(stream))
        assert len(client.execute(sales, query, context=ACME).data) == 500


def test_chdb_stream_past_max_result_rows_fails_as_too_large(chdb_database: str) -> None:
    with create_chdb_executor(database=chdb_database) as executor:
        client = create_dataset_client(
            executor=executor, settings=query_settings(max_result_rows=1000)
        )
        with (
            pytest.raises(CompiledQueryError) as raised,
            client.stream(sales, GROUPED, context=ACME) as stream,
        ):
            for _ in stream:
                pass
        assert raised.value.category == "too-large"


def test_async_chdb_streams_match_execute(chdb_database: str) -> None:
    async def run() -> None:
        executor = create_async_chdb_executor(database=chdb_database)
        async with executor:
            client = create_async_dataset_client(executor=executor)
            executed = await client.execute(sales, GROUPED, context=ACME)
            async with client.stream(sales, GROUPED, context=ACME) as stream:
                streamed = [row async for row in stream.rows()]
            async with client.stream_arrow(sales, GROUPED, context=ACME) as arrow:
                table = await arrow.read_all()
            assert (await client.execute(sales, GROUPED, context=ACME)).data == executed.data
        assert streamed == list(executed.data)
        assert _arrow_as_rows(table) == list(executed.data)

    asyncio.run(run())
