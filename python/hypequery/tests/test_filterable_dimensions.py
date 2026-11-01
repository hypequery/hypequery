"""RFC 0024: declared filters add to the filterable dimensions, not replace them."""

from __future__ import annotations

import pytest

from hypequery.datasets import Dataset, dimension, measure
from hypequery.datasets.aggregations import count
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.dataset import FilterDefinition
from hypequery.datasets.planner import CompiledQueryError, DatasetQuery, plan_dataset_query
from hypequery.datasets.query_helpers import Filter, eq, gte, in_list, like
from hypequery.datasets.registry import create_dataset_registry
from hypequery.datasets.relationships import belongs_to
from hypequery.datasets.utils.effective_filters import effective_filters

PLANS = Dataset(
    name="plans",
    source="analytics.plans",
    dimensions={
        "id": dimension("number"),
        "tier": dimension("string"),
        "region": dimension("string"),
        "internal": dimension("string", filterable=False),
        "label": dimension("string", sql="upper(tier)"),
    },
    filters={"tier_filter": FilterDefinition(field="tier", operators=("eq", "in"))},
)

ACCOUNTS = Dataset(
    name="accounts",
    source="analytics.accounts",
    dimensions={
        "plan": dimension("string"),
        "seats": dimension("number"),
        "country": dimension("string", column="country_code"),
        "notes": dimension("string", filterable=False),
        "plan_id": dimension("number"),
    },
    measures={"accounts": measure(count("id"))},
    filters={
        "plan_filter": FilterDefinition(field="plan", operators=("eq", "in")),
        "notes": FilterDefinition(field="notes", operators=("eq",)),
    },
    relationships={"plan_info": belongs_to(PLANS, from_field="plan_id", to_field="id")},
)

REGISTRY = create_dataset_registry(ACCOUNTS, PLANS)


def _plan(*filters: Filter) -> str:
    return plan_dataset_query(
        ACCOUNTS, DatasetQuery(measures=("accounts",), filters=filters), registry=REGISTRY
    ).sql


def _accepts(*filters: Filter) -> bool:
    try:
        _plan(*filters)
    except CompiledQueryError:
        return False
    return True


def test_every_filterable_dimension_accepts_filters_beside_declared_ones() -> None:
    assert _accepts(eq("plan_filter", "pro"))
    assert _accepts(gte("seats", 10))
    assert _accepts(in_list("plan_id", [1, 2]))
    assert "country_code" in _plan(like("country", "U%"))


def test_a_dimension_takes_the_operators_declared_on_its_field() -> None:
    assert _accepts(in_list("plan", ["pro"]))
    assert not _accepts(like("plan", "%"))
    assert not _accepts(like("plan_filter", "%"))


def test_non_filterable_dimensions_need_a_declared_filter() -> None:
    assert _accepts(eq("notes", "x"))
    assert not _accepts(Filter(field="notes", operator="neq", value="x"))
    assert "internal" not in effective_filters(PLANS)


def test_unknown_fields_and_bad_values_are_still_refused() -> None:
    assert not _accepts(eq("missing", "x"))
    assert not _accepts(eq("seats", "many"))


def test_relationship_filters_reach_every_filterable_non_sql_target_dimension() -> None:
    assert _accepts(eq("plan_info.tier", "gold"))
    assert _accepts(like("plan_info.region", "eu%"))
    assert _accepts(gte("plan_info.id", 1))
    # The target's declared operators still apply across the hop.
    assert not _accepts(like("plan_info.tier", "%"))
    for field in ("plan_info.internal", "plan_info.label", "plan_info.tier_filter"):
        assert not _accepts(eq(field, "x")), field
    assert "JOIN" in _plan(eq("plan_info.region", "eu"))


def test_an_empty_filter_map_keeps_filterable_dimensions() -> None:
    bare = Dataset(
        name="bare",
        source="analytics.bare",
        dimensions={"status": dimension("string"), "secret": dimension("string", filterable=False)},
        measures={"rows": measure(count("id"))},
        filters={},
    )
    plan_dataset_query(bare, DatasetQuery(measures=("rows",), filters=(eq("status", "x"),)))
    with pytest.raises(CompiledQueryError):
        plan_dataset_query(bare, DatasetQuery(measures=("rows",), filters=(eq("secret", "x"),)))


def test_the_catalog_still_lists_only_declared_filters() -> None:
    catalog = get_dataset_catalog(ACCOUNTS, registry=REGISTRY)
    assert sorted(catalog["filters"]) == ["notes", "plan_filter"]
