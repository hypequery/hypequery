"""Streamed dataset endpoints over real engines, served by `to_asgi_app`.

The ClickHouse tests need ``HYPEQUERY_TEST_CLICKHOUSE_HOST``; the chDB test runs
the embedded engine.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from typing import Any

import pyarrow as pa
import pytest

from asgi_client import AsgiClient
from hypequery.datasets import (
    AsyncDatasetClient,
    DatasetClient,
    create_async_dataset_client,
    create_dataset_client,
    dataset,
    dimension,
    measure,
)
from hypequery.execution import (
    ClickHouseConnection,
    create_async_from_sync_clickhouse_executor,
    create_chdb_executor,
    create_clickhouse_executor,
)
from hypequery.serve import (
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    create_api,
    to_asgi_app,
)

DATABASE = "hq_serve_streaming"
PORT = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
TABLE = (
    "CREATE TABLE {db}sales (tenant String, status String, customer UInt32, "
    "amount Decimal(18, 2)) ENGINE = MergeTree ORDER BY (tenant, customer)"
)
ROWS = (
    "INSERT INTO {db}sales SELECT if(number % 2 = 0, 'a', 'b'), "
    "['paid', 'open', 'void', 'refunded', 'held'][intDiv(number, 7) % 5 + 1], "
    "number % 1000, toDecimal64((number % 997) / 10, 2) FROM numbers(60000)"
)
sales = dataset(
    "sales",
    source="sales",
    dimensions={"status": dimension.string(), "customer": dimension.number()},
    measures={"revenue": measure.sum("amount"), "orders": measure.count("customer")},
)
QUERY = {
    "dimensions": ["status", "customer"],
    "measures": ["revenue", "orders"],
    "orderBy": [{"field": "status", "direction": "asc"}, {"field": "customer", "direction": "asc"}],
}


def _served(client: DatasetClient | AsyncDatasetClient, production: bool = False) -> AsgiClient:
    api = create_api(
        auth=lambda credential: Principal(subject="reader"),
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile(max_result_rows=10_001, max_result_bytes=64 << 20)
        if production
        else None,
    )
    add_dataset_endpoint(
        api,
        "/query",
        dataset=sales,
        client=client,
        policy=EndpointPolicy(max_limit=10_000, stream_max_rows=10_000),
    )
    return AsgiClient(to_asgi_app(api))


def _post(http: AsgiClient, accept: str | None = None) -> Any:
    headers = {"authorization": "Bearer t", "content-type": "application/json"}
    if accept:
        headers["accept"] = accept
    return http.post("/query", headers=headers, content=json.dumps(QUERY).encode())


def _check(http: AsgiClient) -> None:
    page = _post(http).json()["data"]
    assert len(page) == 5000

    ndjson = _post(http, "application/x-ndjson")
    assert ndjson.headers["content-type"] == "application/x-ndjson"
    frames = [json.loads(line) for line in ndjson.text.splitlines()]
    assert frames[0] == {"type": "start"}
    assert frames[-1] == {"type": "end", "rowCount": len(page)}
    assert [row for f in frames if f["type"] == "rows" for row in f["data"]] == page

    arrow = _post(http, "application/vnd.apache.arrow.stream")
    assert arrow.headers["content-type"] == "application/vnd.apache.arrow.stream"
    table = pa.ipc.open_stream(arrow.content).read_all()
    assert table.num_rows == len(page)
    assert table.column("customer").to_pylist() == [row["customer"] for row in page]
    assert [str(value) for value in table.column("revenue").to_pylist()] == [
        row["revenue"] for row in page
    ]


@pytest.fixture(scope="module")
def clickhouse() -> Iterator[ClickHouseConnection]:
    if "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ:
        pytest.skip("live ClickHouse service is not configured")
    import clickhouse_connect

    admin = clickhouse_connect.get_client(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=PORT,
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    admin.command(f"DROP DATABASE IF EXISTS {DATABASE}")
    admin.command(f"CREATE DATABASE {DATABASE}")
    admin.command(TABLE.format(db=f"{DATABASE}."))
    admin.command(ROWS.format(db=f"{DATABASE}."))
    try:
        yield ClickHouseConnection(
            host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
            port=PORT,
            database=DATABASE,
            username="default",
            password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
        )
    finally:
        admin.command(f"DROP DATABASE IF EXISTS {DATABASE}")
        admin.close()


@pytest.mark.parametrize("production", [False, True])
def test_a_sync_client_streams_over_asgi(
    clickhouse: ClickHouseConnection, production: bool
) -> None:
    with create_clickhouse_executor(clickhouse) as executor:
        _check(_served(create_dataset_client(executor=executor), production))


def test_an_async_client_streams_over_asgi(clickhouse: ClickHouseConnection) -> None:
    # The bridge binds to the loop it first waits on: the test client's.
    executor = create_async_from_sync_clickhouse_executor(clickhouse, max_concurrent=1)
    try:
        _check(_served(create_async_dataset_client(executor=executor), production=True))
    finally:
        executor.close()


def test_chdb_streams_over_asgi() -> None:
    pytest.importorskip("chdb")
    database = f"hq_serve_stream_{uuid.uuid4().hex[:8]}"
    with create_chdb_executor() as setup:
        setup._connection.query(f"CREATE DATABASE {database}")
        setup._connection.query(TABLE.format(db=f"{database}."))
        setup._connection.query(ROWS.format(db=f"{database}."))
        try:
            with create_chdb_executor(database=database) as executor:
                _check(_served(create_dataset_client(executor=executor)))
        finally:
            setup._connection.query(f"DROP DATABASE {database}")
