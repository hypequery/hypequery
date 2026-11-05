"""Ported ClickHouse features against a live server, compared with hand-written SQL."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from hypequery.datasets import (
    DatasetQuery,
    FilterDefinition,
    create_dataset_client,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

pytestmark = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)

DATABASE = "hq_feature_port"
PORT = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))

customers = dataset(
    "customers",
    source="customers",
    dimensions={
        "plan": dimension.string(),
        "trial": dimension.boolean(),
        "churnedAt": dimension.timestamp(column="churned_at"),
    },
    measures={
        "customers": measure.count("plan"),
        "churned": measure.count("plan", filters=(filter.is_not_null("churnedAt"),)),
    },
    filters={
        "churnedAt": FilterDefinition(field="churnedAt", operators=("gte", "isNull", "isNotNull")),
        "trial": FilterDefinition(field="trial", operators=("eq", "isNull")),
    },
)


@pytest.fixture(scope="module")
def admin() -> Iterator[object]:
    import clickhouse_connect

    client = clickhouse_connect.get_client(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=PORT,
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    client.command(f"DROP DATABASE IF EXISTS {DATABASE}")
    client.command(f"CREATE DATABASE {DATABASE}")
    client.command(
        f"CREATE TABLE {DATABASE}.customers (plan String, trial Nullable(Bool), "
        "churned_at Nullable(DateTime64(3, 'UTC'))) ENGINE = Memory"
    )
    client.command(
        "INSERT INTO hq_feature_port.customers VALUES "
        "('pro', true, '2026-02-01 00:00:00'), ('pro', NULL, NULL), "
        "('free', false, NULL), ('free', NULL, '1969-07-20 20:17:00')"
    )
    client.command(
        "CREATE TABLE hq_feature_port.visits (user_id UInt64, kind String) ENGINE = Memory"
    )
    # 200,000 distinct users: well past where uniq stops being exact.
    client.command(
        "INSERT INTO hq_feature_port.visits SELECT number, "
        "if(number % 3 = 0, 'purchase', 'view') FROM numbers(200000)"
    )
    yield client
    client.command(f"DROP DATABASE IF EXISTS {DATABASE}")


@pytest.fixture(scope="module")
def client(admin: object) -> Iterator[object]:
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
            port=PORT,
            database=DATABASE,
            username="default",
            password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
        )
    )
    yield create_dataset_client(executor=executor)
    executor.close()


def _truth(admin: object, sql: str) -> list[tuple[object, ...]]:
    return [tuple(row) for row in admin.query(sql).result_rows]  # type: ignore[attr-defined]


def _rows(client: object, query: DatasetQuery) -> list[tuple[object, ...]]:
    result = client.execute(customers, query)  # type: ignore[attr-defined]
    return [tuple(row.values()) for row in result.data]


def test_null_checks_match_is_null_including_a_pre_1971_date(admin: object, client: object) -> None:
    # A sentinel range such as churned_at >= '1971-01-01' would miss the 1969 row.
    query = DatasetQuery(
        dimensions=("plan",),
        measures=("customers", "churned"),
        filters=(filter.is_null("trial"),),
        order_by=(),
    )
    expected = _truth(
        admin,
        "SELECT plan, count(plan), countIf(plan, churned_at IS NOT NULL) "
        "FROM hq_feature_port.customers WHERE trial IS NULL GROUP BY plan ORDER BY plan",
    )
    actual = sorted(_rows(client, query), key=str)
    assert [tuple(str(value) for value in row) for row in actual] == [
        tuple(str(value) for value in row) for row in expected
    ]
    churned = _rows(
        client,
        DatasetQuery(measures=("customers",), filters=(filter.is_not_null("churnedAt"),)),
    )
    assert str(churned[0][0]) == "2"


visits = dataset(
    "visits",
    source="visits",
    dimensions={"userId": dimension.number(column="user_id"), "kind": dimension.string()},
    measures={
        "visitors": measure.count_distinct("userId"),
        "estimatedVisitors": measure.approx_count_distinct("userId"),
        "estimatedBuyers": measure.approx_count_distinct(
            "userId", filters=(filter.eq("kind", "purchase"),)
        ),
    },
)


def test_approx_count_distinct_is_uniq_and_count_distinct_stays_exact(
    admin: object, client: object
) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        visits, DatasetQuery(measures=("visitors", "estimatedVisitors", "estimatedBuyers"))
    )
    row = result.data[0]
    truth = _truth(
        admin,
        "SELECT uniqExact(user_id), uniq(user_id), uniqIf(user_id, kind = 'purchase') "
        "FROM hq_feature_port.visits",
    )[0]
    assert [str(row["visitors"]), str(row["estimatedVisitors"]), str(row["estimatedBuyers"])] == [
        str(value) for value in truth
    ]
    assert str(row["visitors"]) == "200000"
