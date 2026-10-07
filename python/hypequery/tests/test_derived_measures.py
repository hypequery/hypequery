"""Derived business metrics retain aggregate semantics across every surface."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hypequery.datasets import (
    CachedRows,
    Dataset,
    DatasetQuery,
    DerivedMeasure,
    HavingCondition,
    Measure,
    add,
    build_protocol_deployment_contract,
    coalesce,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    divide,
    eq,
    get_dataset_catalog,
    measure,
    null_if_zero,
    plan_dataset_query,
    serialize_semantic_contract,
)
from hypequery.datasets import (
    round as round_,
)
from hypequery.datasets.client.results import ResultRows
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, ExecutionContext, tenant
from hypequery.serve import (
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)

ROOT = Path(__file__).resolve().parents[3]


def orders() -> Dataset:
    return Dataset(
        name="orders",
        source="test_db.beta_derived",
        tenant_key="tenant_id",
        dimensions={
            "amount": dimension.number(),
            "category": dimension.string(),
            "status": dimension.string(),
        },
        measures={
            "revenue": measure.sum("amount"),
            "orders": measure.count("amount"),
            "paidRevenue": measure.sum("amount", filters=(eq("status", "paid"),)),
            "average": measure.derived(divide("revenue", null_if_zero("orders"))),
            "rounded": measure.derived(round_("average", 2)),
            "paidRate": measure.derived(
                coalesce(divide("paidRevenue", null_if_zero("revenue")), 0)
            ),
        },
    )


def test_definition_roundtrip_and_dependency_validation() -> None:
    ds = orders()
    assert Dataset.model_validate(ds.model_dump()) == ds
    average = ds.measures["average"]
    assert isinstance(average, DerivedMeasure)
    assert DerivedMeasure.model_validate_json(average.model_dump_json()) == average
    bad_definitions: list[dict[str, Measure | DerivedMeasure]] = [
        {"value": measure.derived(add("missing", "missing"))},
        {"a": measure.derived(add("b", "b")), "b": measure.derived(add("a", "a"))},
        {"value": measure.derived(add("customer.revenue", "customer.revenue"))},
        {"name": measure.min("category"), "value": measure.derived(add("name", "name"))},
        {"revenue": measure.sum("amount"), "value": measure.derived(add("revenue", True))},
    ]
    for definitions in bad_definitions:
        with pytest.raises(ValidationError):
            Dataset(name="bad", source="bad", dimensions=ds.dimensions, measures=definitions)


def test_planning_has_aggregate_dependencies_and_selected_having_only() -> None:
    query = DatasetQuery(
        dimensions=("category",),
        measures=("average", "paidRate"),
        having=(HavingCondition(measure="average", operator="gt", value=2),),
    )
    compiled = plan_dataset_query(orders(), query, context=ExecutionContext(tenant=tenant("a")))
    assert "(sum(`amount`) / NULLIF(count(`amount`), 0)) AS `average`" in compiled.sql
    assert "sumIf(" in compiled.sql
    assert " HAVING " in compiled.sql
    assert " GROUP BY `category`" in compiled.sql
    with pytest.raises(CompiledQueryError, match="selected measures"):
        plan_dataset_query(
            orders(),
            DatasetQuery(
                measures=("average",),
                having=(HavingCondition(measure="revenue", operator="gt", value=2),),
            ),
            context=ExecutionContext(tenant=tenant("a")),
        )


def test_contract_identity_and_shared_deployment_fixture() -> None:
    ds = orders()
    registry = create_dataset_registry(ds)
    catalog = get_dataset_catalog(ds, registry=registry)
    assert set(catalog["derivedMeasures"]) == {"average", "rounded", "paidRate"}
    first = serialize_semantic_contract(registry)
    changed = Dataset(
        name=ds.name,
        source=ds.source,
        tenant_key=ds.tenant_key,
        dimensions=ds.dimensions,
        filters=ds.filters,
        measures={
            **ds.measures,
            "average": measure.derived(divide("paidRevenue", null_if_zero("orders"))),
        },
    )
    assert (
        first["contentHash"]
        != serialize_semantic_contract(create_dataset_registry(changed))["contentHash"]
    )
    portable = Dataset(
        name=ds.name,
        source=ds.source,
        tenant_key=ds.tenant_key,
        dimensions=ds.dimensions,
        filters=ds.filters,
        measures={
            name: definition for name, definition in ds.measures.items() if name != "rounded"
        },
    )
    actual = build_protocol_deployment_contract(create_dataset_registry(portable))
    assert actual == json.loads((ROOT / "specs/datasets/derived-authoring-v1.json").read_text())
    assert first == json.loads((ROOT / "specs/datasets/derived-contract-v1.json").read_text())


class Executor:
    def execute(self, query: CompiledQuery) -> ResultRows:
        return CachedRows(columns=("average",), rows=((3.0,),))


def test_derived_http_and_discovery() -> None:
    ds = orders()
    router = create_router(
        authenticate=lambda credential: Principal(subject="reader", tenant_id="a")
    )
    client = create_dataset_client(executor=Executor())
    add_dataset_endpoint(router, "/query", dataset=ds, client=client)
    add_metric_endpoint(router, "/average", dataset=ds, client=client, measure="average")
    add_discovery_endpoint(router, registry=create_dataset_registry(ds))
    with TestClient(
        create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    ) as http:
        headers = {"Authorization": "Bearer test"}
        assert (
            http.post("/query", headers=headers, json={"measures": ["average"]}).status_code == 200
        )
        assert http.post("/average", headers=headers, json={}).status_code == 200
        catalog = http.get("/discovery", headers=headers).json()["datasets"][0]
        assert "average" in {entry["name"] for entry in catalog["measures"]}
        assert "expression" not in json.dumps(catalog)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)
def test_live_derived_metrics_sync_async_and_nulls() -> None:
    import asyncio

    import clickhouse_connect

    from hypequery.datasets import create_async_dataset_client
    from hypequery.execution import (
        ClickHouseConnection,
        create_async_clickhouse_executor,
        create_clickhouse_executor,
    )

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
    context = ExecutionContext(tenant=tenant("a"))
    query = DatasetQuery(dimensions=("category",), measures=("average", "rounded", "paidRate"))
    try:
        admin.command("DROP TABLE IF EXISTS beta_derived")
        admin.command(
            "CREATE TABLE beta_derived (amount Float64, category String, "
            "status String, tenant_id String) ENGINE=Memory"
        )
        admin.command(
            "INSERT INTO beta_derived VALUES (10, 'paid', 'paid', 'a'), "
            "(20, 'paid', 'unpaid', 'a'), (0, 'zero', 'paid', 'a'), "
            "(999, 'other', 'paid', 'b')"
        )
        result = create_dataset_client(executor=executor).execute(orders(), query, context=context)
        raw = admin.query(
            "SELECT category, sum(amount)/nullIf(count(amount), 0) AS average, "
            "round(sum(amount)/nullIf(count(amount), 0), 2) AS rounded, "
            "coalesce(sumIf(amount, status='paid')/nullIf(sum(amount), 0), 0) AS paidRate "
            "FROM beta_derived WHERE tenant_id={tenant:String} GROUP BY category",
            parameters={"tenant": "a"},
        )
        assert sorted(tuple(row.values()) for row in result.data) == sorted(
            tuple(row) for row in raw.result_rows
        )

        async def run() -> None:
            async_executor = await create_async_clickhouse_executor(connection)
            try:
                actual = await create_async_dataset_client(executor=async_executor).execute(
                    orders(), query, context=context
                )
                assert actual.data == result.data
            finally:
                await async_executor.aclose()

        asyncio.run(run())
    finally:
        executor.close()
        admin.command("DROP TABLE IF EXISTS beta_derived")
        admin.close()


def test_default_selection_and_publication_limits() -> None:
    ds = orders()
    compiled = plan_dataset_query(ds, context=ExecutionContext(tenant=tenant("a")))
    assert "AS `average`" not in compiled.sql
    with pytest.raises(ValueError, match="reference base measures"):
        build_protocol_deployment_contract(create_dataset_registry(ds))


def test_other_formula_operations_and_bound_literals() -> None:
    from hypequery.datasets import ceil, floor, multiply, subtract

    ds = orders()
    definitions = {
        "ceiling": measure.derived(ceil("revenue")),
        "flooring": measure.derived(floor("revenue")),
        "difference": measure.derived(subtract("revenue", "paidRevenue")),
        "scaled": measure.derived(multiply("revenue", 100)),
        "nullable": measure.derived(coalesce("revenue", None)),
    }
    expanded = Dataset(
        name=ds.name,
        source=ds.source,
        tenant_key=ds.tenant_key,
        dimensions=ds.dimensions,
        measures={**ds.measures, **definitions},
    )
    compiled = plan_dataset_query(
        expanded,
        DatasetQuery(measures=tuple(definitions)),
        context=ExecutionContext(tenant=tenant("a")),
    )
    assert "CEIL(sum(`amount`))" in compiled.sql
    assert "FLOOR(sum(`amount`))" in compiled.sql
    assert "COALESCE(sum(`amount`), NULL)" in compiled.sql
    assert 100 in compiled.parameter_values().values()
    assert "100" not in compiled.sql


@pytest.mark.parametrize("reverse", [False, True])
def test_dependency_depth_is_independent_of_declaration_order(reverse: bool) -> None:

    definitions: dict[str, Measure | DerivedMeasure] = {"base": measure.sum("amount")}
    previous = "base"
    for index in range(17):
        name = f"d{index}"
        definitions[name] = measure.derived(add(previous, 1))
        previous = name
    if reverse:
        definitions = dict(reversed(tuple(definitions.items())))
    with pytest.raises(ValidationError, match="dependency depth"):
        Dataset(name="tooDeep", source="orders", dimensions={}, measures=definitions)


def test_repeated_dependency_expansion_is_bounded() -> None:

    definitions: dict[str, Measure | DerivedMeasure] = {"base": measure.sum("amount")}
    previous = "base"
    for index in range(12):
        name = f"d{index}"
        definitions[name] = measure.derived(add(previous, previous))
        previous = name
    with pytest.raises(ValidationError, match="expansion limit"):
        Dataset(name="tooWide", source="orders", dimensions={}, measures=definitions)


def test_formula_tree_depth_is_bounded_before_reference_walk() -> None:
    formula = add("base", 1)
    for _ in range(17):
        formula = add(formula, 1)
    with pytest.raises(ValidationError, match="formula depth"):
        Dataset(
            name="deepFormula",
            source="orders",
            dimensions={},
            measures={"base": measure.sum("amount"), "value": measure.derived(formula)},
        )
