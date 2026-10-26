"""Datasets on a live Postgres, and parity with ClickHouse over the same rows.

HYPEQUERY_TEST_POSTGRES_URL=postgresql://postgres@localhost:55432/postgres runs the
Postgres suite; the parity suite also needs HYPEQUERY_TEST_CLICKHOUSE_HOST and
HYPEQUERY_TEST_CLICKHOUSE_PASSWORD (and HYPEQUERY_TEST_CLICKHOUSE_PORT).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import urllib.request
from base64 import b64encode
from collections.abc import Iterator
from datetime import datetime

import pytest

from hypequery.datasets import (
    DatasetQuery,
    ExecutionContext,
    create_async_dataset_client,
    create_dataset_client,
    tenant,
)
from hypequery.datasets import filter as f
from hypequery.datasets import order as o
from hypequery.datasets.planner import CompiledQueryError, Deadline, plan_dataset_query
from hypequery.datasets.planner.dialects import POSTGRES
from hypequery.datasets.query_helpers import HavingCondition
from hypequery.execution import (
    ClickHouseConnection,
    create_async_postgres_executor,
    create_clickhouse_executor,
    create_postgres_executor,
)
from postgres_parity_model import build_model, customer_rows, order_rows

POSTGRES_URL = os.environ.get("HYPEQUERY_TEST_POSTGRES_URL")
CLICKHOUSE_HOST = os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_HOST")
SCHEMA = "hq_py_parity"
ACME = ExecutionContext(tenant=tenant("acme"))

requires_postgres = pytest.mark.skipif(POSTGRES_URL is None, reason="no live Postgres")
requires_both = pytest.mark.skipif(
    POSTGRES_URL is None or CLICKHOUSE_HOST is None, reason="needs Postgres and ClickHouse"
)

Orders, Customers, REGISTRY = build_model(SCHEMA)


def _having(name: str, operator: str, value: object) -> HavingCondition:
    return HavingCondition.model_validate({"measure": name, "operator": operator, "value": value})


NY_FALL = f.between("created_at", "2025-11-01T00:00:00", "2025-11-03T00:00:00")

#: Every case runs on both engines and must return the same rows.
CASES: dict[str, dict[str, object]] = {
    "every-aggregation": {
        "dimensions": ("status",),
        "measures": (
            "revenue",
            "orders",
            "buyers",
            "avgAmount",
            "minAmount",
            "maxAmount",
            "p95",
            "median",
            "spread",
            "variance",
            "topRegion",
            "bottomRegion",
        ),
    },
    "measure-filters": {
        "dimensions": ("region",),
        "measures": ("paidRevenue", "giftOrders", "paidP90", "euBuyers"),
    },
    "derived": {"dimensions": ("status",), "measures": ("average", "rounded", "paidShare")},
    "unguarded-division": {"dimensions": ("region",), "measures": ("unguarded",)},
    "relationships": {
        "dimensions": ("customer.country",),
        "measures": (
            "revenue",
            "customer.customerCount",
            "customer.bestScore",
            "customer.goldCustomers",
        ),
        "order_by": (o.desc("revenue"),),
    },
    "relationship-filter": {
        "dimensions": ("status",),
        "measures": ("orders",),
        "filters": (f.eq("customer.tier", "gold"),),
    },
    "filters": {
        "dimensions": ("region",),
        "measures": ("orders", "revenue"),
        "filters": (
            f.in_list("status", ["paid", "shipped"]),
            f.not_in_list("region", ["apac"]),
            f.like("status", "%a%"),
            f.between("amount", 100, 40_000),
            f.neq("gift", True),
        ),
    },
    "time-filters-in-zone": {
        "dimensions": ("status",),
        "measures": ("orders",),
        "timezone": "America/New_York",
        "filters": (
            f.gte("created_at", "2026-01-02T00:00:00"),
            f.lt("created_at", "2026-02-01T05:00:00Z"),
            f.in_list("status", ["paid", "refunded"]),
        ),
    },
    **{
        f"grain-{grain}": {"by": grain, "measures": ("revenue", "orders"), "filters": (NY_FALL,)}
        for grain in ("minute", "hour", "day")
    },
    **{
        f"grain-{grain}": {"by": grain, "measures": ("revenue", "orders")}
        for grain in ("week", "month", "quarter", "year")
    },
    "grain-hour-dst-fall": {
        "by": "hour",
        "measures": ("revenue", "orders"),
        "timezone": "America/New_York",
        "filters": (NY_FALL,),
    },
    "grain-day-kathmandu-by-status": {
        "by": "day",
        "dimensions": ("status",),
        "measures": ("revenue",),
        "timezone": "Asia/Kathmandu",
        "filters": (f.between("created_at", "2026-02-01T00:00:00", "2026-02-10T00:00:00"),),
        "order_by": (o.desc("revenue"),),
    },
    "having": {
        "dimensions": ("customer_id",),
        "measures": ("revenue", "average"),
        "having": (
            _having("revenue", "gt", 100_000),
            _having("average", "between", [10_000, 30_000]),
        ),
    },
    "order-desc-nulls-limit-offset": {
        "dimensions": ("status",),
        "measures": ("orders",),
        "order_by": (o.desc("status"),),
        "limit": 3,
        "offset": 1,
    },
}


def _query(case: dict[str, object]) -> DatasetQuery:
    return DatasetQuery.model_validate(case)


@pytest.fixture(scope="module")
def postgres_executor() -> Iterator[object]:
    import psycopg

    assert POSTGRES_URL is not None
    with psycopg.connect(POSTGRES_URL, autocommit=True) as connection:
        connection.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        connection.execute(f'CREATE SCHEMA "{SCHEMA}"')
        connection.execute(
            f'CREATE TABLE "{SCHEMA}".orders (tenant_id text, customer_id bigint, status text, '
            "region_code text, is_gift boolean, amount_cents bigint, created_at timestamptz)"
        )
        connection.execute(
            f'CREATE TABLE "{SCHEMA}".customers (customer_id bigint, tenant_id text, '
            "country_code text, tier text, score double precision)"
        )
        connection.execute(f'CREATE INDEX orders_created_at ON "{SCHEMA}".orders (created_at)')
        with connection.cursor() as cursor:
            cursor.executemany(
                f'INSERT INTO "{SCHEMA}".orders VALUES (%s, %s, %s, %s, %s, %s, %s)',  # noqa: S608
                [tuple(row.values()) for row in order_rows()],
            )
            cursor.executemany(
                f'INSERT INTO "{SCHEMA}".customers VALUES (%s, %s, %s, %s, %s)',  # noqa: S608
                [tuple(row.values()) for row in customer_rows()],
            )
    yield create_postgres_executor(POSTGRES_URL)
    with psycopg.connect(POSTGRES_URL, autocommit=True) as connection:
        connection.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')


def _clickhouse(sql: str, body: bytes | None = None) -> None:
    host = CLICKHOUSE_HOST
    port = os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")
    password = os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PASSWORD", "")
    url = f"http://{host}:{port}/?" + urllib.parse.urlencode({"query": sql})
    request = urllib.request.Request(url, data=body or b"", method="POST")
    request.add_header(
        "Authorization", "Basic " + b64encode(f"default:{password}".encode()).decode()
    )
    with urllib.request.urlopen(request) as response:  # noqa: S310 - local test server
        response.read()


@pytest.fixture(scope="module")
def clickhouse_executor() -> Iterator[object]:
    def encode(rows: list[dict[str, object]]) -> bytes:
        return "\n".join(
            json.dumps(
                {
                    key: value.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                    if isinstance(value, datetime)
                    else value
                    for key, value in row.items()
                }
            )
            for row in rows
        ).encode()

    _clickhouse(f"DROP DATABASE IF EXISTS {SCHEMA}")
    _clickhouse(f"CREATE DATABASE {SCHEMA}")
    _clickhouse(
        f"CREATE TABLE {SCHEMA}.orders (tenant_id String, customer_id Nullable(Int64), "
        "status Nullable(String), region_code String, is_gift Bool, amount_cents Int64, "
        "created_at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY tuple()"
    )
    _clickhouse(
        f"CREATE TABLE {SCHEMA}.customers (customer_id Int64, tenant_id String, "
        "country_code String, tier String, score Float64) ENGINE = MergeTree ORDER BY tuple()"
    )
    _clickhouse(f"INSERT INTO {SCHEMA}.orders FORMAT JSONEachRow", encode(order_rows()))
    _clickhouse(f"INSERT INTO {SCHEMA}.customers FORMAT JSONEachRow", encode(customer_rows()))
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=CLICKHOUSE_HOST or "",
            port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
            database=SCHEMA,
            username="default",
            password=os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PASSWORD", ""),
        )
    )
    yield executor
    executor.close()
    _clickhouse(f"DROP DATABASE IF EXISTS {SCHEMA}")


def _same(left: object, right: object) -> bool:
    if isinstance(left, float) or isinstance(right, float):
        if left is None or right is None:
            return left is right
        a, b = float(left), float(right)  # type: ignore[arg-type]
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    return left == right


@requires_both
@pytest.mark.parametrize("name", sorted(CASES))
def test_postgres_matches_clickhouse(
    name: str, postgres_executor: object, clickhouse_executor: object
) -> None:
    case = CASES[name]
    query = _query(case)
    results = []
    for executor in (clickhouse_executor, postgres_executor):
        client = create_dataset_client(executor=executor, registry=REGISTRY)  # type: ignore[arg-type]
        results.append(client.execute(Orders, query, context=ACME, use_cache=False))
    on_clickhouse, on_postgres = results
    assert on_postgres.columns == on_clickhouse.columns
    expected, actual = list(on_clickhouse.data), list(on_postgres.data)
    if "order_by" not in case and "by" not in case:
        # Ties in an unordered result may come back in any order.
        expected.sort(key=repr)
        actual.sort(key=repr)
    assert len(actual) == len(expected), (len(expected), len(actual))
    assert expected, f"{name} compares no rows"
    for index, (want, got) in enumerate(zip(expected, actual, strict=True)):
        for column in on_clickhouse.columns:
            assert _same(want[column], got[column]), (index, column, want, got)


@requires_postgres
def test_async_executor_matches_sync(postgres_executor: object) -> None:
    sync = create_dataset_client(executor=postgres_executor, registry=REGISTRY)  # type: ignore[arg-type]
    query = _query(CASES["relationships"])

    async def run() -> object:
        executor = await create_async_postgres_executor(POSTGRES_URL)
        client = create_async_dataset_client(executor=executor, registry=REGISTRY)
        return await client.execute(Orders, query, context=ACME, use_cache=False)

    on_async = asyncio.run(run())
    assert on_async.data == sync.execute(Orders, query, context=ACME, use_cache=False).data  # type: ignore[attr-defined]


@requires_postgres
def test_time_filters_compare_the_bare_column(postgres_executor: object) -> None:
    import psycopg

    compiled = plan_dataset_query(
        Orders,
        _query(CASES["time-filters-in-zone"]),
        registry=REGISTRY,
        context=ACME,
        dialect=POSTGRES,
    )
    assert POSTGRES_URL is not None
    with psycopg.connect(POSTGRES_URL) as connection:
        connection.execute("SET enable_seqscan = off")
        cursor = psycopg.RawCursor(connection)
        cursor.execute("EXPLAIN " + compiled.sql, compiled.positional_parameter_values())
        plan = "\n".join(row[0] for row in cursor.fetchall())
    assert "orders_created_at" in plan, plan
    assert '"created_at" >=' in compiled.sql


@requires_postgres
def test_execution_is_read_only_bounded_and_dialect_checked(postgres_executor: object) -> None:
    executor = postgres_executor
    compiled = plan_dataset_query(Orders, _query(CASES["filters"]), registry=REGISTRY, context=ACME)
    with pytest.raises(CompiledQueryError) as mismatch:
        executor.execute(compiled)  # type: ignore[attr-defined]
    assert mismatch.value.category == "internal"

    from dataclasses import replace

    pg = plan_dataset_query(
        Orders, _query({"dimensions": ("status", "region"), "measures": ("orders",)}),
        registry=REGISTRY, context=ACME, dialect=POSTGRES,
    )  # fmt: skip
    from hypequery.datasets.planner.settings import query_settings

    with pytest.raises(CompiledQueryError) as too_many:
        executor.execute(replace(pg, settings=query_settings(max_result_rows=3)))  # type: ignore[attr-defined]
    assert too_many.value.category == "too-large"

    writing = replace(
        pg, sql="SELECT 1 FROM (SELECT set_config('x.y', '1', false)) AS s, pg_sleep(0)"
    )
    assert executor.execute(replace(writing, parameters={})).rows == ((1,),)  # type: ignore[attr-defined]


@requires_postgres
def test_cancellation_stops_the_query_on_the_server(postgres_executor: object) -> None:
    from dataclasses import replace

    base = plan_dataset_query(
        Orders, _query({"measures": ("orders",)}), registry=REGISTRY, context=ACME, dialect=POSTGRES
    )
    sleeping = replace(base, sql="SELECT pg_sleep(5) AS slept", parameters={})
    cancellation = threading.Event()
    threading.Timer(0.2, cancellation.set).start()
    started = datetime.now()
    with pytest.raises(CompiledQueryError) as stopped:
        postgres_executor.execute(replace(sleeping, cancellation=cancellation))  # type: ignore[attr-defined]
    assert stopped.value.category == "aborted"
    assert (datetime.now() - started).total_seconds() < 3

    with pytest.raises(CompiledQueryError) as expired:
        postgres_executor.execute(replace(sleeping, deadline=Deadline.after(0.3)))  # type: ignore[attr-defined]
    assert expired.value.category == "deadline-exceeded"
