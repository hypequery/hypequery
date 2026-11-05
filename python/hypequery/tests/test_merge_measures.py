"""Merge measures over stored aggregate states (RFC 0022)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Never

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    CompiledQuery,
    DatasetQuery,
    Measure,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
)
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.formulas import divide, null_if_zero
from hypequery.datasets.planner import CompiledQueryError
from hypequery.datasets.utils.output_column_types import output_column_types
from hypequery.protocol.deployment_primitives import AGGREGATE_STATE_FUNCTIONS

FIXTURE = Path(__file__).resolve().parents[3] / "specs/datasets/merge-authoring-v1.json"


class _Executor:
    def execute(self, compiled: CompiledQuery) -> Never:
        raise AssertionError("planning only")


DAILY_USERS = dataset(
    "dailyUsers",
    source="analytics.daily_users",
    time_key="day",
    dimensions={"day": dimension.timestamp(), "region": dimension.string()},
    measures={
        "activeUsers": measure.merge("uniq", "users", label="Active users"),
        "exactUsers": measure.merge("uniqExact", "exact_users"),
        "events": measure.merge("count", "event_states"),
        "revenue": measure.merge("sum", "revenue_state"),
        "revenuePerUser": measure.derived(divide("revenue", null_if_zero("exactUsers"))),
    },
)
REGISTRY = create_dataset_registry(DAILY_USERS)
CLIENT = create_dataset_client(executor=_Executor(), registry=REGISTRY)


def test_publishes_the_same_contract_as_typescript() -> None:
    assert build_protocol_deployment_contract(REGISTRY) == json.loads(FIXTURE.read_text())


def test_renders_the_merge_combinator_across_grouped_rows() -> None:
    statement = CLIENT.to_sql(
        DAILY_USERS,
        DatasetQuery(dimensions=("region",), measures=("activeUsers", "events", "revenuePerUser")),
    )
    assert "uniqMerge(`__hq_base`.`users`) AS `activeUsers`" in statement
    assert "countMerge(`__hq_base`.`event_states`) AS `events`" in statement
    assert "sumMerge(`__hq_base`.`revenue_state`)" in statement
    assert "uniqExactMerge(`__hq_base`.`exact_users`)" in statement


@pytest.mark.parametrize(
    "build",
    [
        lambda: measure.merge("quantile", "users"),
        lambda: measure.merge("uniq); DROP TABLE x; --", "users"),
        lambda: measure.merge("uniq", "users", filters=(filter.eq("region", "EU"),)),
        lambda: measure.merge("uniq", "users", sql="users"),
        lambda: measure.sum("amount").model_validate(
            {"aggregation": "sum", "field": "amount", "state_function": "sum"}
        ),
    ],
)
def test_only_listed_state_functions_without_filters_or_sql(build: object) -> None:
    with pytest.raises(ValidationError):
        build()  # type: ignore[operator]


def test_the_state_function_list_is_the_protocols() -> None:
    for name in AGGREGATE_STATE_FUNCTIONS:
        assert measure.merge(name, "states").state_function == name


def test_catalog_marks_estimating_states_and_names_the_state_function() -> None:
    catalog = get_dataset_catalog(DAILY_USERS, registry=REGISTRY)
    measures = catalog["measures"]
    assert measures["activeUsers"]["stateFunction"] == "uniq"
    assert measures["activeUsers"]["approximate"] is True
    assert "approximate" not in measures["exactUsers"]
    assert "approximate" not in catalog["derivedMeasures"]["revenuePerUser"]


def test_result_types_follow_the_state_function() -> None:
    query = DatasetQuery(measures=("activeUsers", "events", "revenue"))
    assert output_column_types(DAILY_USERS, query, REGISTRY) == ("integer", "integer", "number")


def test_states_are_not_merged_through_a_relationship() -> None:
    sessions = dataset(
        "sessions",
        source="sessions",
        dimensions={"day": dimension.timestamp()},
        measures={"sessions": measure.count("day")},
        relationships={"daily": belongs_to(DAILY_USERS, from_field="day", to_field="day")},
    )
    client = create_dataset_client(
        executor=_Executor(), registry=create_dataset_registry(sessions, DAILY_USERS)
    )
    with pytest.raises(CompiledQueryError, match="cannot merge aggregate states"):
        client.to_sql(sessions, DatasetQuery(measures=("daily.activeUsers",)))


def test_client_contracts_offer_having_only_on_numeric_merge_states() -> None:
    from hypequery.datasets.client_contract.fields import numeric_measure

    states = dataset(
        "states",
        source="states",
        dimensions={"day": dimension.timestamp()},
        measures={
            "users": measure.merge("uniq", "users"),
            "revenue": measure.merge("sum", "revenue_state"),
            # These merge to the stored value, which may be a string or a date.
            **{
                name: measure.merge(name, f"{name}_state")
                for name in ("min", "max", "any", "anyLast")
            },
        },
    )
    having = {
        name: numeric_measure(states, definition)
        for name, definition in states.measures.items()
        if isinstance(definition, Measure)
    }
    assert having == {
        "users": True,
        "revenue": True,
        "min": False,
        "max": False,
        "any": False,
        "anyLast": False,
    }
