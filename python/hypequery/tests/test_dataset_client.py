"""PYB-09: the dataset client plans, executes, and shapes results.

The executor here is a recording double. What matters is what the client hands
it, which is always a planner-built `CompiledQuery`, and what the client makes
of the rows that come back.
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field

import pytest

from hypequery.datasets import (
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    belongs_to,
    count,
    create_async_dataset_client,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    eq,
    measure,
    tenant,
)
from hypequery.datasets.client import ResultScalar


@dataclass(frozen=True)
class _Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class _Executor:
    rows: _Rows = field(default_factory=lambda: _Rows(("vendor", "trips"), (("a", 2), ("b", 1))))
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> _Rows:
        self.seen.append(compiled)
        return self.rows


@dataclass
class _AsyncExecutor:
    inner: _Executor = field(default_factory=_Executor)

    async def execute(self, compiled: CompiledQuery) -> _Rows:
        return self.inner.execute(compiled)


def _customers() -> Dataset:
    return Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"country": dimension("string")},
        measures={},
    )


def _trips(*, tenant_key: str | None = None) -> Dataset:
    return Dataset(
        name="trips",
        source="analytics.trips",
        tenant_key=tenant_key,
        dimensions={"vendor": dimension("string"), "customer_id": dimension("string")},
        measures={"trips": measure(count("id"))},
        relationships={
            "customer": belongs_to(_customers(), from_field="customer_id", to_field="id")
        },
    )


def test_execute_keys_rows_by_column_and_reports_safe_meta() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor)

    result = client.execute(_trips(), DatasetQuery(dimensions=("vendor",), measures=("trips",)))

    assert result.columns == ("vendor", "trips")
    assert result.data == ({"vendor": "a", "trips": 2}, {"vendor": "b", "trips": 1})
    assert result.meta.row_count == 2
    assert result.meta.query_id == executor.seen[0].query_id
    assert result.meta.timing_ms >= 0
    assert result.meta.cache == "off"
    assert set(type(result.meta).__slots__) == {
        "query_id",
        "row_count",
        "timing_ms",
        "cache",
        "pagination",
    }


def test_the_executor_receives_the_planned_statement_with_bound_values() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor)

    client.execute(_trips(), DatasetQuery(measures=("trips",), filters=(eq("vendor", "x'y"),)))

    compiled = executor.seen[0]
    assert "x'y" not in compiled.sql
    assert compiled.parameter_values() == {"p0": "x'y"}


def test_a_mapping_query_is_validated_into_the_request_model() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor)

    client.execute(
        _trips(),
        {
            "dimensions": ["vendor"],
            "measures": ["trips"],
            "filters": [{"field": "vendor", "operator": "eq", "value": "a"}],
            "limit": 10,
        },
    )

    assert executor.seen[0].sql.endswith("LIMIT 10")


def test_a_mapping_that_is_not_a_query_is_input_invalid_without_echoing_input() -> None:
    client = create_dataset_client(executor=_Executor())

    with pytest.raises(CompiledQueryError) as caught:
        client.execute(_trips(), {"dimensions": ["vendor"], "sql": "DROP TABLE secret_marker"})

    assert caught.value.category == "input-invalid"
    assert "secret_marker" not in caught.value.message
    assert "sql" in caught.value.message


def test_a_registered_name_resolves_and_relationships_use_the_registry() -> None:
    executor = _Executor()
    registry = create_dataset_registry(_trips(), _customers())
    client = create_dataset_client(executor=executor, registry=registry)

    client.execute("trips", DatasetQuery(dimensions=("customer.country",), measures=("trips",)))

    assert "`analytics`.`customers`" in executor.seen[0].sql


def test_an_unknown_name_is_not_found_and_not_echoed() -> None:
    client = create_dataset_client(executor=_Executor(), registry=create_dataset_registry())

    with pytest.raises(CompiledQueryError) as caught:
        client.execute("unknown_marker")

    assert caught.value.category == "not-found"
    assert "unknown_marker" not in caught.value.message


def test_a_dataset_that_conflicts_with_the_registry_is_refused() -> None:
    registry = create_dataset_registry(_trips())
    client = create_dataset_client(executor=_Executor(), registry=registry)

    with pytest.raises(ValueError, match="differs"):
        client.execute(_trips(tenant_key="org_id"), DatasetQuery(measures=("trips",)))


def test_tenant_scope_comes_from_the_context_only() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor)
    dataset = _trips(tenant_key="org_id")

    with pytest.raises(CompiledQueryError) as caught:
        client.execute(dataset, DatasetQuery(measures=("trips",)))
    assert caught.value.category == "tenant-required"
    assert executor.seen == []

    client.execute(
        dataset, DatasetQuery(measures=("trips",)), context=ExecutionContext(tenant=tenant("t1"))
    )
    assert executor.seen[0].parameter_values() == {"p0": "t1"}


def test_to_sql_is_the_redacted_debug_form() -> None:
    client = create_dataset_client(executor=_Executor())

    sql = client.to_sql(_trips(), DatasetQuery(measures=("trips",), filters=(eq("vendor", "v"),)))

    assert "'v'" not in sql
    assert "{p0:String}" not in sql


def test_validate_reports_problems_without_executing() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor)

    assert client.validate(_trips(), DatasetQuery(measures=("trips",))).valid
    unknown = client.validate(_trips(), DatasetQuery(dimensions=("missing",)))
    assert not unknown.valid
    assert unknown.errors
    malformed = client.validate(_trips(), {"limit": -1})
    assert not malformed.valid
    assert "limit" in malformed.errors[0]
    assert executor.seen == []


def test_validate_raises_rather_than_reporting_a_cancelled_call() -> None:
    signal = threading.Event()
    signal.set()
    client = create_dataset_client(executor=_Executor())
    context = ExecutionContext(cancellation=signal)

    with pytest.raises(CompiledQueryError) as caught:
        client.validate(_trips(), DatasetQuery(measures=("trips",)), context=context)
    assert caught.value.category == "aborted"


def test_the_async_client_matches_the_sync_client() -> None:
    executor = _AsyncExecutor()
    client = create_async_dataset_client(executor=executor)

    result = asyncio.run(
        client.execute(_trips(), DatasetQuery(dimensions=("vendor",), measures=("trips",)))
    )

    assert result.data == ({"vendor": "a", "trips": 2}, {"vendor": "b", "trips": 1})
    assert result.meta.query_id == executor.inner.seen[0].query_id
    assert client.validate(_trips(), DatasetQuery(measures=("trips",))).valid
