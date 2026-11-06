"""approxCountDistinct: ClickHouse `uniq`, marked approximate wherever it surfaces."""

from __future__ import annotations

from typing import Never

import pytest

from hypequery.datasets import (
    CompiledQuery,
    DatasetQuery,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
)
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.contract import serialize_semantic_contract
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.formulas import divide


class _Executor:
    def execute(self, compiled: CompiledQuery) -> Never:
        raise AssertionError("planning only")


USERS = dataset(
    "users",
    source="users",
    dimensions={"id": dimension.string(), "region": dimension.string()},
    measures={"regions": measure.approx_count_distinct("region")},
)
EVENTS = dataset(
    "events",
    source="events",
    dimensions={
        "userId": dimension.string(column="user_id"),
        "kind": dimension.string(),
    },
    measures={
        "visitors": measure.approx_count_distinct("userId"),
        "buyers": measure.approx_count_distinct("userId", filters=(filter.eq("kind", "purchase"),)),
        "events": measure.count("kind"),
        "eventsPerVisitor": measure.derived(divide("events", "visitors")),
        # Exact inputs only, so not approximate.
        "eventsPerEvent": measure.derived(divide("events", "events")),
    },
    relationships={"user": belongs_to(USERS, from_field="userId", to_field="id")},
)
REGISTRY = create_dataset_registry(EVENTS, USERS)
CLIENT = create_dataset_client(executor=_Executor(), registry=REGISTRY)


def test_renders_uniq_and_uniq_if_for_filtered_measures() -> None:
    assert "uniq(`__hq_base`.`user_id`) AS `visitors`" in CLIENT.to_sql(
        EVENTS, DatasetQuery(measures=("visitors",))
    )
    filtered = CLIENT.to_sql(EVENTS, DatasetQuery(measures=("buyers",)))
    assert "uniqIf(`__hq_base`.`user_id`, `__hq_base`.`kind` = " in filtered
    # The exact count stays exact.
    exact = measure.count_distinct("userId").aggregation
    assert exact == "countDistinct"


def test_it_is_duplicate_insensitive_through_belongs_to() -> None:
    statement = CLIENT.to_sql(EVENTS, DatasetQuery(measures=("events", "user.regions")))
    assert "uniq(" in statement


def test_catalog_and_contract_mark_estimates_and_their_derived_measures() -> None:
    catalog = get_dataset_catalog(EVENTS, registry=REGISTRY)
    assert catalog["measures"]["visitors"]["approximate"] is True
    assert catalog["measures"]["buyers"]["approximate"] is True
    assert "approximate" not in catalog["measures"]["events"]
    derived = catalog["derivedMeasures"]
    assert derived["eventsPerVisitor"]["approximate"] is True
    assert "approximate" not in derived["eventsPerEvent"]
    contract = serialize_semantic_contract(REGISTRY)
    events = contract["datasets"]["events"]  # type: ignore[index]
    assert events["measures"]["visitors"]["approximate"] is True
    assert events["derivedMeasures"]["eventsPerVisitor"]["approximate"] is True


def test_result_columns_are_integers() -> None:
    from hypequery.datasets.utils.output_column_types import output_column_types

    query = DatasetQuery(measures=("visitors", "user.regions"))
    assert output_column_types(EVENTS, query, REGISTRY) == ("integer", "integer")


def test_publishing_is_refused_until_deployment_contract_3() -> None:
    with pytest.raises(ValueError, match=r"events\.visitors uses approxCountDistinct"):
        build_protocol_deployment_contract(REGISTRY)
