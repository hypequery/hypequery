"""Read-only uniqueness qualification over real and recorded target rows."""

from __future__ import annotations

import asyncio
import os

import pytest

from hypequery.datasets import (
    CachedRows,
    Dataset,
    ExecutionContext,
    RelationshipKey,
    all_tenants,
    belongs_to,
    check_relationships,
    check_relationships_async,
    create_dataset_registry,
    dimension,
    has_many,
    has_one,
    tenant,
    tenants,
)
from hypequery.datasets.client.results import ResultRows
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline
from hypequery.datasets.utils.relationship_key_check import read_count


def definitions(composite: bool = False) -> tuple[Dataset, Dataset]:
    target = Dataset(
        name="customers",
        source="test_db.beta_relationships",
        tenant_key="tenant_id",
        dimensions={"id": dimension.number(), "region": dimension.string()},
    )
    relation = belongs_to(target, from_field="customer_id", to_field="id")
    if composite:
        relation = belongs_to(
            target,
            keys=(
                RelationshipKey(from_field="customer_id", to_field="id"),
                RelationshipKey(from_field="region", to_field="region"),
            ),
        )
    orders = Dataset(
        name="orders",
        source="orders",
        dimensions={"id": dimension.number()},
        relationships={
            "customer": relation,
            "many": has_many(target, from_field="id", to_field="id"),
            "one": has_one(target, from_field="id", to_field="id"),
        },
    )
    return orders, target


class Executor:
    def __init__(self, rows: int | str = 3, keys: int | str = 2) -> None:
        self.rows, self.keys = rows, keys
        self.queries: list[CompiledQuery] = []

    def execute(self, compiled: CompiledQuery) -> ResultRows:
        self.queries.append(compiled)
        return CachedRows(columns=("__hq_rows", "__hq_keys"), rows=((self.rows, self.keys),))


class AsyncExecutor:
    def __init__(self, sync: Executor) -> None:
        self.sync = sync

    async def execute(self, compiled: CompiledQuery) -> ResultRows:
        return self.sync.execute(compiled)


def test_findings_sync_async_and_context_propagation() -> None:
    ds, target = definitions()
    registry = create_dataset_registry(ds, target)
    executor = Executor(2**53 + 1, 2)
    context = ExecutionContext(
        tenant=tenant("secret"), deadline=Deadline.after(10), correlation_id="check"
    )
    result = check_relationships(ds, executor=executor, registry=registry, context=context)
    assert not result.ok
    assert result.checked == ("customer", "one")
    assert result.issues[0].rows == str(2**53 + 1)
    assert result.issues[0].distinct_keys == 2
    assert result.issues[0].columns == ("id",)
    assert "arbitrary matching row" in result.issues[0].message
    assert "secret" not in executor.queries[0].sql
    assert executor.queries[0].parameter_values() == {"p0": "secret"}
    assert executor.queries[0].deadline == context.deadline
    assert executor.queries[0].correlation_id == "check"
    actual = asyncio.run(
        check_relationships_async(
            ds, executor=AsyncExecutor(executor), registry=registry, context=context
        )
    )
    assert actual == result


@pytest.mark.parametrize("scope", [tenant("a"), tenants(("a", "b")), all_tenants()])
def test_composite_null_keys_and_scoped_plan(scope: object) -> None:
    from typing import cast

    from hypequery.datasets.planner import TenantScope

    ds, target = definitions(composite=True)
    executor = Executor(0, 0)
    result = check_relationships(
        ds,
        executor=executor,
        registry=create_dataset_registry(ds, target),
        context=ExecutionContext(tenant=cast(TenantScope, scope)),
        relationships=("customer",),
    )
    assert result.ok
    sql = executor.queries[0].sql
    assert "uniqExact(tuple(`id`, `region`))" in sql
    assert "isNotNull(`id`) AND isNotNull(`region`)" in sql


def test_fail_closed_before_execution_and_filter_selection() -> None:
    ds, target = definitions()
    registry = create_dataset_registry(ds, target)
    executor = Executor()
    with pytest.raises(CompiledQueryError):
        check_relationships(ds, executor=executor, registry=registry)
    assert not executor.queries
    for selected in (("missing",), ("many",), ("customer", "customer")):
        with pytest.raises(ValueError, match=r"Relationship|Distinct|non-negative"):
            check_relationships(
                ds,
                executor=executor,
                registry=registry,
                relationships=selected,
                context=ExecutionContext(tenant=tenant("a")),
            )
    empty = check_relationships(ds, executor=executor, registry=registry, relationships=())
    assert empty.ok
    assert empty.checked == ()
    with pytest.raises(CompiledQueryError):
        check_relationships(
            ds,
            executor=executor,
            registry=registry,
            context=ExecutionContext(deadline=Deadline.after(-1)),
        )
    with pytest.raises(ValueError, match=r"Relationship|Distinct|non-negative"):
        check_relationships(
            ds,
            executor=Executor(1, 2),
            registry=registry,
            context=ExecutionContext(tenant=tenant("a")),
        )


@pytest.mark.parametrize("bad", [True, -1, 0.5, "-2", "", "\u0661"])
def test_reject_malformed_counts(bad: object) -> None:
    with pytest.raises(ValueError, match=r"Relationship|Distinct|non-negative"):
        read_count(bad)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)
def test_live_unique_duplicate_composite_null_and_tenant_keys() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    connection = ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
        database="test_db",
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    admin = clickhouse_connect.get_client(
        host=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
        database="test_db",
    )
    executor = create_clickhouse_executor(connection)
    ds, target = definitions(composite=True)
    registry = create_dataset_registry(ds, target)
    try:
        admin.command("DROP TABLE IF EXISTS beta_relationships")
        admin.command(
            "CREATE TABLE beta_relationships (id Nullable(UInt64), "
            "region Nullable(String), tenant_id String) ENGINE=Memory"
        )
        admin.command(
            "INSERT INTO beta_relationships VALUES (1, 'eu', 'a'), (1, 'us', 'a'), "
            "(NULL, 'eu', 'a'), (1, NULL, 'a'), (1, 'eu', 'b'), (1, 'eu', 'b')"
        )
        for tenant_id, expected in (("a", True), ("b", False)):
            result = check_relationships(
                ds,
                executor=executor,
                registry=registry,
                relationships=("customer",),
                context=ExecutionContext(tenant=tenant(tenant_id)),
            )
            assert result.ok is expected
            if not expected:
                assert result.issues[0].rows == 2
                assert result.issues[0].distinct_keys == 1
    finally:
        executor.close()
        admin.command("DROP TABLE IF EXISTS beta_relationships")
        admin.close()


def test_later_unscoped_target_prevents_every_database_read() -> None:
    _, protected = definitions()
    public = Dataset(
        name="publicCustomers", source="public_customers", dimensions={"id": dimension.number()}
    )
    root = Dataset(
        name="orders",
        source="orders",
        dimensions={"id": dimension.number()},
        relationships={
            "validFirst": belongs_to(public, from_field="id", to_field="id"),
            "protectedSecond": belongs_to(protected, from_field="id", to_field="id"),
        },
    )
    registry = create_dataset_registry(root, public, protected)
    executor = Executor()
    with pytest.raises(CompiledQueryError):
        check_relationships(root, executor=executor, registry=registry)
    with pytest.raises(CompiledQueryError):
        asyncio.run(
            check_relationships_async(root, executor=AsyncExecutor(executor), registry=registry)
        )
    assert executor.queries == []
