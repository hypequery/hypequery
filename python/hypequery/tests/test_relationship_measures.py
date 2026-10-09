"""Target base measures selected through to-one relationships (HQ-83 parity)."""

from __future__ import annotations

import os
import re

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    ExecutionContext,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    get_dataset_catalog,
    get_queryable_relationship_measures,
    has_many,
    has_one,
    measure,
    tenant,
)
from hypequery.datasets.aggregations import (
    arg_max,
    arg_min,
    avg,
    count,
    count_distinct,
    max,  # noqa: A004
    min,  # noqa: A004
    sum,  # noqa: A004
)
from hypequery.datasets.planner import CompiledQueryError, plan_dataset_query
from hypequery.datasets.query_helpers import (
    asc,
    desc,
    eq,
)
from hypequery.serve.utils.discovery import public_discovery

Targets = Dataset(
    name="targets",
    source="targets",
    tenant_key="tenant_id",
    dimensions={
        "id": dimension("number"),
        "value": dimension("number", column="score"),
        "tier": dimension("string"),
        "computed": dimension("number", sql="score + 1"),
    },
    measures={
        "unique": measure(count_distinct("id")),
        "lowest": measure(min("value")),
        "highest": measure(max("value")),
        "latest": measure(arg_max("tier", "value")),
        "earliest": measure(arg_min("tier", "value")),
        "total": measure(sum("value")),
        "count": measure(count("id")),
        "mean": measure(avg("value")),
        "gold": measure(count_distinct("id"), filters=(eq("tier", "gold"),)),
        "raw": measure(min("score"), sql="score + 1"),
        "computedMin": measure(min("computed")),
        "computedFilter": measure(count_distinct("id"), filters=(eq("computed", 2),)),
    },
)

Sources = Dataset(
    name="sources",
    source="sources",
    dimensions={
        "id": dimension("number"),
        "status": dimension("string"),
        "amount": dimension("number"),
    },
    measures={"total": measure(sum("amount"))},
    relationships={
        "target": belongs_to(lambda: Targets, from_field="target_id", to_field="id"),
        "profile": has_one(lambda: Targets, from_field="id", to_field="id"),
        "many": has_many(lambda: Targets, from_field="id", to_field="id"),
    },
)

REGISTRY = create_dataset_registry(Sources, Targets)
CONTEXT = ExecutionContext(tenant=tenant("a"))


def _sql(query: DatasetQuery, *, dataset: Dataset = Sources, registry: object = REGISTRY) -> str:
    return plan_dataset_query(dataset, query, registry=registry, context=CONTEXT).sql  # type: ignore[arg-type]


def _error(query: DatasetQuery, context: ExecutionContext = CONTEXT) -> str:
    with pytest.raises(CompiledQueryError) as raised:
        plan_dataset_query(Sources, query, registry=REGISTRY, context=context)
    return str(raised.value)


@pytest.mark.parametrize("name", ["unique", "lowest", "highest", "latest", "earliest", "gold"])
def test_belongs_to_allows_duplicate_insensitive_aggregates(name: str) -> None:
    assert f"AS `target.{name}`" in _sql(DatasetQuery(measures=(f"target.{name}",)))


@pytest.mark.parametrize("name", ["total", "count", "mean"])
def test_duplicate_sensitive_aggregates_require_has_one(name: str) -> None:
    assert "repeated target rows" in _error(DatasetQuery(measures=(f"target.{name}",)))
    assert f"AS `profile.{name}`" in _sql(DatasetQuery(measures=(f"profile.{name}",)))


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("many.unique", "cannot traverse hasMany"),
        ("target.next.unique", "one-hop"),
        ("target.raw", "SQL-backed"),
        ("target.computedMin", "SQL-backed"),
        ("target.computedFilter", "SQL-backed"),
        ("target.missing", "Unknown measure"),
        ("nowhere.unique", "Unknown relationship"),
    ],
)
def test_unsupported_relationship_measures_are_rejected(name: str, message: str) -> None:
    assert message in _error(DatasetQuery(measures=(name,)))


def test_tenancy_is_required_when_only_a_target_measure_is_selected() -> None:
    assert "requires runtime tenant" in _error(
        DatasetQuery(measures=("target.unique",)), ExecutionContext()
    )


def test_one_guarded_join_serves_dimensions_measures_filters_and_ordering() -> None:
    sql = _sql(
        DatasetQuery(
            dimensions=("target.tier",),
            measures=("total", "target.unique", "target.gold"),
            filters=(eq("target.tier", "gold"),),
            order_by=(desc("target.unique"),),
        )
    )
    assert sql.count("LEFT ANY JOIN") == 1
    assert "toNullable(1) AS `_hq_match`" in sql
    assert "isNotNull(`target`.`_hq_match`)" in sql
    assert re.search(r"`target`\.`tenant_id` = \{p\d+:String\}", sql)
    assert re.search(r"uniqExactIf\(.*`target`\.`tier` = \{p\d+:String\}\) AS `target.gold`", sql)
    assert "ORDER BY `target.unique` DESC" in sql


def test_count_counts_only_matched_target_rows() -> None:
    sql = _sql(DatasetQuery(measures=("profile.count",)))
    assert "count(if(isNotNull(`profile`.`_hq_match`), `profile`.`id`, NULL))" in sql


def test_arg_aggregates_guard_both_inputs() -> None:
    sql = _sql(DatasetQuery(measures=("target.latest",)))
    assert (
        "argMax(if(isNotNull(`target`.`_hq_match`), `target`.`tier`, NULL), "
        "if(isNotNull(`target`.`_hq_match`), `target`.`score`, NULL))"
    ) in sql


def test_match_marker_avoids_authored_target_columns() -> None:
    target = Dataset(
        name="markerTarget",
        source="marker_targets",
        dimensions={"id": dimension("number"), "_hq_match": dimension("number")},
        measures={"unique": measure(count_distinct("id"))},
    )
    source = Dataset(
        name="markerSource",
        source="marker_sources",
        dimensions={"id": dimension("number")},
        relationships={"target": belongs_to(lambda: target, from_field="id", to_field="id")},
    )
    sql = _sql(
        DatasetQuery(measures=("target.unique",)),
        dataset=source,
        registry=create_dataset_registry(source, target),
    )
    assert "toNullable(1) AS `_hq_match_`" in sql
    assert "isNotNull(`target`.`_hq_match_`)" in sql


def test_an_output_cannot_be_both_a_dimension_and_a_measure() -> None:
    target = Dataset(
        name="overlappingTarget",
        source="overlapping_targets",
        dimensions={"id": dimension("number")},
        measures={"id": measure(count_distinct("id"))},
    )
    source = Dataset(
        name="overlappingSource",
        source="overlapping_sources",
        dimensions={"id": dimension("number")},
        relationships={"target": belongs_to(lambda: target, from_field="id", to_field="id")},
    )
    registry = create_dataset_registry(source, target)
    with pytest.raises(CompiledQueryError, match="cannot be selected as both"):
        _sql(
            DatasetQuery(dimensions=("target.id",), measures=("target.id",)),
            dataset=source,
            registry=registry,
        )
    assert _sql(
        DatasetQuery(dimensions=("target.id",), measures=()), dataset=source, registry=registry
    )
    # Omitting measures selects every base measure, so the overlap still counts.
    with pytest.raises(CompiledQueryError, match="cannot be selected as both"):
        _sql(DatasetQuery(dimensions=("id",)), dataset=target, registry=registry)
    assert _sql(DatasetQuery(dimensions=("id",), measures=()), dataset=target, registry=registry)
    assert _sql(DatasetQuery(measures=("target.id",)), dataset=source, registry=registry)


def test_catalog_and_discovery_advertise_only_safe_names() -> None:
    catalog = get_dataset_catalog(Sources, registry=REGISTRY)
    assert list(catalog["relationships"]["target"].get("measures", {})) == [
        "target.unique",
        "target.lowest",
        "target.highest",
        "target.latest",
        "target.earliest",
        "target.gold",
    ]
    assert "profile.total" in catalog["relationships"]["profile"].get("measures", {})
    assert "measures" not in catalog["relationships"]["many"]
    assert "target.unique" in catalog["orderableFields"]
    assert "target.total" not in get_queryable_relationship_measures(catalog)
    names = [
        entry["name"]
        for dataset in public_discovery(REGISTRY)["datasets"]  # type: ignore[attr-defined]
        if dataset["name"] == "sources"
        for entry in dataset["measures"]
    ]
    assert names == sorted(names)
    assert {"total", "target.unique", "profile.total"} <= set(names)
    assert "target.total" not in names


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_unmatched_and_other_tenant_rows_never_feed_target_aggregates() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    admin = clickhouse_connect.get_client(
        host=host, port=port, username="default", password=password
    )
    admin.command("CREATE DATABASE IF NOT EXISTS hq_relationship_measures")
    admin.command("DROP TABLE IF EXISTS hq_relationship_measures.targets")
    admin.command("DROP TABLE IF EXISTS hq_relationship_measures.sources")
    admin.command(
        "CREATE TABLE hq_relationship_measures.targets "
        "(id UInt32, tenant_id String, score Float64, tier String) ENGINE = Memory"
    )
    admin.command(
        "CREATE TABLE hq_relationship_measures.sources "
        "(id UInt32, target_id UInt32, status String, amount Float64) ENGINE = Memory"
    )
    admin.command(
        "INSERT INTO hq_relationship_measures.targets VALUES "
        "(1, 'a', 10, 'gold'), (2, 'a', 20, 'silver'), (3, 'b', 99, 'gold')"
    )
    # Source 4 points at another tenant's target and source 5 at none: both keep
    # their own amounts but must not feed a target aggregate (a default 0 would
    # otherwise become the minimum).
    admin.command(
        "INSERT INTO hq_relationship_measures.sources VALUES "
        "(1, 1, 'paid', 5), (2, 1, 'paid', 7), (3, 3, 'open', 1), (4, 3, 'paid', 2), "
        "(5, 9, 'paid', 4)"
    )
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=host,
            port=port,
            database="hq_relationship_measures",
            username="default",
            password=password,
        )
    )
    try:
        client = create_dataset_client(executor=executor, registry=REGISTRY)
        result = client.execute(
            "sources",
            DatasetQuery(
                dimensions=("status",),
                measures=(
                    "total",
                    "target.unique",
                    "target.lowest",
                    "target.gold",
                    "profile.total",
                    "profile.count",
                ),
                order_by=(asc("status"),),
            ),
            context=CONTEXT,
        )
        assert result.data == (
            {
                "status": "open",
                "total": 1.0,
                "target.unique": 0,
                "target.lowest": None,
                "target.gold": 0,
                "profile.total": None,
                "profile.count": 0,
            },
            {
                "status": "paid",
                "total": 18.0,
                "target.unique": 1,
                "target.lowest": 10.0,
                "target.gold": 1,
                "profile.total": 30.0,
                "profile.count": 2,
            },
        )
    finally:
        executor.close()
        admin.command("DROP DATABASE IF EXISTS hq_relationship_measures")
        admin.close()


@pytest.mark.parametrize("field", ["undeclared", "elsewhere.tier"])
def test_target_measure_filters_must_name_target_dimensions(field: str) -> None:
    target = Dataset(
        name="filteredTarget",
        source="filtered_targets",
        dimensions={"id": dimension("number")},
        measures={"unique": measure(count_distinct("id"), filters=(eq(field, 1),))},
    )
    source = Dataset(
        name="filteredSource",
        source="filtered_sources",
        dimensions={"id": dimension("number")},
        relationships={"target": belongs_to(lambda: target, from_field="id", to_field="id")},
    )
    registry = create_dataset_registry(source, target)
    with pytest.raises(CompiledQueryError, match="is not a dimension"):
        _sql(DatasetQuery(measures=("target.unique",)), dataset=source, registry=registry)
    catalog = get_dataset_catalog(source, registry=registry)
    assert "measures" not in catalog["relationships"]["target"]


def test_an_unregistered_target_is_an_internal_error() -> None:
    with pytest.raises(CompiledQueryError) as raised:
        _sql(DatasetQuery(measures=("target.unique",)), registry=create_dataset_registry(Sources))
    assert raised.value.category == "internal"


def test_related_measures_beside_a_local_derived_projection() -> None:
    # Mirrors TypeScript's relationship-measures test of the same name.
    from hypequery.datasets.formulas import (
        add,
    )

    sources = Dataset(
        name=Sources.name,
        source=Sources.source,
        dimensions=Sources.dimensions,
        measures={**Sources.measures, "twice": measure.derived(add("total", "total"))},
        relationships=Sources.relationships,
    )
    sql = _sql(
        DatasetQuery(measures=("twice", "target.unique")),
        dataset=sources,
        registry=create_dataset_registry(sources, Targets),
    )
    assert "AS `twice`" in sql
    assert "AS `target.unique`" in sql
    assert "isNotNull(`target`.`_hq_match`)" in sql
