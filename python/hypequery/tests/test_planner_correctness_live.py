"""Planner answers against a live ClickHouse, compared with hand-written SQL.

Each case is one the SQL text alone would not catch: how ClickHouse resolves a
name, joins a reused key, or divides a Decimal.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from decimal import Decimal

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    ExecutionContext,
    all_tenants,
    belongs_to,
    check_relationships,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
    tenant,
    tenants,
)
from hypequery.datasets.formulas import divide, null_if_zero
from hypequery.datasets.formulas import round as round_
from hypequery.datasets.query_helpers import Filter, eq
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

pytestmark = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)

DATABASE = "hq_planner_correctness"

customers = Dataset(
    name="customers",
    source="customers",
    tenant_key="tenant_id",
    dimensions={"id": dimension.string(), "name": dimension.string()},
    measures={"count": measure.count("id")},
)
orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    dimensions={
        "id": dimension.string(),
        # Named like other columns: `status` reads `country`, as a renamed column would.
        "status": dimension.string(column="country"),
        "orderStatus": dimension.string(column="status"),
        "orderAmount": dimension.number(column="amount"),
    },
    measures={
        "amount": measure.sum("amount"),
        "largest": measure.max("amount"),
        "orders": measure.count("id"),
        "average": measure.derived(round_(divide("amount", null_if_zero("orders")), 2)),
        "paid": measure.sum("amount", filters=(eq("orderStatus", "paid"),)),
        "paidShare": measure.derived(divide("paid", null_if_zero("amount"))),
    },
    relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
)
REGISTRY = create_dataset_registry(customers, orders)


@pytest.fixture(scope="module")
def admin() -> Iterator[object]:
    import clickhouse_connect

    client = clickhouse_connect.get_client(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    client.command("DROP DATABASE IF EXISTS hq_planner_correctness")
    client.command("CREATE DATABASE hq_planner_correctness")
    client.command(
        "CREATE TABLE hq_planner_correctness.customers (tenant_id String, id String, name String) "
        "ENGINE = Memory"
    )
    client.command(
        "CREATE TABLE hq_planner_correctness.orders (tenant_id String, id String, "
        "customer_id String, country String, status String, amount Decimal(12, 2)) ENGINE = Memory"
    )
    # Customer c1 exists in both tenants; a join on the key alone mixes them.
    client.command(
        "INSERT INTO hq_planner_correctness.customers VALUES "
        "('a', 'c1', 'Alpha One'), ('a', 'c2', 'Alpha Two'), ('b', 'c1', 'Beta One')"
    )
    # Tenant a's amounts sum to 2.00 over 3 orders: an exact average of 0.666...
    client.command(
        "INSERT INTO hq_planner_correctness.orders VALUES "
        "('a', 'o1', 'c1', 'NZ', 'paid', 0.70), ('a', 'o2', 'c1', 'NZ', 'paid', 0.67), "
        "('a', 'o3', 'c2', 'AU', 'refunded', 0.63), "
        "('b', 'o1', 'c1', 'DE', 'paid', 4000.00), ('b', 'o2', 'c1', 'US', 'paid', 3000.00)"
    )
    yield client
    client.command("DROP DATABASE IF EXISTS hq_planner_correctness")


@pytest.fixture(scope="module")
def executor(admin: object) -> Iterator[object]:
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
            port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
            database=DATABASE,
            username="default",
            password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
        )
    )
    yield executor
    executor.close()


def _truth(admin: object, sql: str) -> list[tuple[object, ...]]:
    return [tuple(row) for row in admin.query(sql).result_rows]  # type: ignore[attr-defined]


@pytest.mark.parametrize("scope", [tenants(("a", "b")), all_tenants()], ids=["several", "all"])
def test_a_join_across_tenants_matches_each_row_within_its_own_tenant(
    admin: object, executor: object, scope: object
) -> None:
    client = create_dataset_client(executor=executor, registry=REGISTRY)  # type: ignore[arg-type]
    result = client.execute(
        orders,
        DatasetQuery(dimensions=("customer.name",), measures=("amount",)),
        context=ExecutionContext(tenant=scope),  # type: ignore[arg-type]
    )
    got = {row["customer.name"]: Decimal(str(row["amount"])) for row in result.data}
    expected = {
        name: Decimal(str(total))
        for name, total in _truth(
            admin,
            "SELECT c.name, sum(o.amount) FROM hq_planner_correctness.orders AS o "
            "JOIN hq_planner_correctness.customers AS c "
            "ON c.tenant_id = o.tenant_id AND c.id = o.customer_id "
            "GROUP BY c.name",
        )
    }
    assert (
        got
        == expected
        == {
            "Alpha One": Decimal("1.37"),
            "Alpha Two": Decimal("0.63"),
            "Beta One": Decimal("7000.00"),
        }
    )


def test_a_key_reused_by_another_tenant_is_not_a_duplicate(executor: object) -> None:
    for scope in (tenant("a"), tenants(("a", "b")), all_tenants()):
        checked = check_relationships(
            orders,
            executor=executor,  # type: ignore[arg-type]
            registry=REGISTRY,
            context=ExecutionContext(tenant=scope),
        )
        assert checked.ok, checked.issues


def test_an_output_alias_never_captures_a_column_of_the_same_name(
    admin: object, executor: object
) -> None:
    client = create_dataset_client(executor=executor).for_tenant(tenant("a"))  # type: ignore[arg-type]
    result = client.execute(
        orders,
        DatasetQuery(
            dimensions=("status", "orderStatus"),
            measures=("amount", "largest"),
            filters=(
                eq("orderStatus", "paid"),
                Filter(field="orderAmount", operator="gt", value=0.5),
            ),
        ),
    )
    got = [
        (
            row["status"],
            row["orderStatus"],
            Decimal(str(row["amount"])),
            Decimal(str(row["largest"])),
        )
        for row in result.data
    ]
    expected = [
        (country, status, Decimal(str(total)), Decimal(str(largest)))
        for country, status, total, largest in _truth(
            admin,
            "SELECT country, status, sum(amount), max(amount) FROM hq_planner_correctness.orders "
            "WHERE tenant_id = 'a' AND status = 'paid' AND amount > 0.5 "
            "GROUP BY country, status",
        )
    ]
    assert got == expected == [("NZ", "paid", Decimal("1.37"), Decimal("0.70"))]


def test_a_derived_division_is_not_truncated_to_the_decimal_scale(executor: object) -> None:
    client = create_dataset_client(executor=executor).for_tenant(tenant("a"))  # type: ignore[arg-type]
    row = client.execute(orders, DatasetQuery(measures=("average", "paidShare"))).data[0]
    # 2.00 / 3 is 0.666..., so 0.67 rounded; Decimal division truncated it to 0.66.
    assert float(str(row["average"])) == pytest.approx(0.67)
    # Decimal / Decimal kept the dividend's two places: 1.37 / 2.00 came back 0.68.
    assert float(str(row["paidShare"])) == pytest.approx(0.685)
