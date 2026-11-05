"""Window and shift measures (RFC 0015): validation, planning shape and projections.

Results are checked against ClickHouse in `test_clickhouse_features_live.py`.
"""

from __future__ import annotations

import re
from typing import Never

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    Dataset,
    DatasetQuery,
    DerivedMeasure,
    FilterDefinition,
    Measure,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    export_client_contract,
    filter,  # noqa: A004
    measure,
)
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.client_contract.fields import public_fields
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.formulas import divide, null_if_zero
from hypequery.datasets.planner import CompiledQueryError, plan_dataset_query
from hypequery.datasets.query_helpers import HavingCondition
from hypequery.datasets.time_measures import ShiftMeasure, WindowMeasure


class _Executor:
    def execute(self, compiled: object) -> Never:
        raise AssertionError("planning only")


AnyMeasure = Measure | DerivedMeasure | WindowMeasure | ShiftMeasure
MEASURES: dict[str, AnyMeasure] = {
    "revenue": measure.sum("amount"),
    "buyers": measure.count_distinct("customer_id"),
    "rolling7": measure.trailing("revenue", 7, "day"),
    "monthToDate": measure.to_date("revenue", "month"),
    "running": measure.cumulative("revenue"),
    "lastWeek": measure.shift("revenue", 7, "day"),
    "lastMonth": measure.shift("revenue", 1, "month"),
    "weekOverWeek": measure.derived(divide("revenue", null_if_zero("lastWeek"))),
}


def sales(**measures: AnyMeasure) -> Dataset:
    return dataset(
        "sales",
        source="sales",
        time_key="sold_at",
        dimensions={
            "channel": dimension.string(),
            "soldAt": dimension.timestamp(column="sold_at"),
        },
        measures={**MEASURES, **measures},
    )


SALES = sales()
JANUARY = (filter.gte("soldAt", "2026-01-01"), filter.lt("soldAt", "2026-02-01"))


def sql(*measures: str, **query: object) -> str:
    fields: dict[str, object] = {"by": "day", "filters": JANUARY, **query}
    return plan_dataset_query(SALES, DatasetQuery(measures=measures, **fields)).sql  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"cumulative": True, "to_date": "month"},
        {"to_date": "minute"},
    ],
)
def test_a_window_declares_exactly_one_supported_mode(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        WindowMeasure.model_validate({"measure": "revenue", **fields})


def test_window_definitions_are_checked_against_the_dataset() -> None:
    with pytest.raises(ValueError, match="requires the dataset to define time_key"):
        dataset(
            "untimed",
            source="sales",
            dimensions={"amount": dimension.number()},
            measures={"revenue": measure.sum("amount"), "r": measure.trailing("revenue", 7, "day")},
        )
    with pytest.raises(ValueError, match="must wrap a base measure"):
        sales(nested=measure.trailing("weekOverWeek", 7, "day"))
    with pytest.raises(ValueError, match="cannot accumulate countDistinct"):
        sales(runningBuyers=measure.cumulative("buyers"))


def test_a_window_query_is_one_bounded_statement() -> None:
    statement = sql("revenue", "rolling7", "monthToDate", "running")
    assert statement.startswith("WITH ")
    for cte in ("_hq_raw", "_hq_bounds", "_hq_series", "_hq_skeleton", "_hq_result"):
        assert f"{cte} AS" in statement
    # The SQL guards the exact series size; Python only estimates it.
    assert "throwIf(" in statement
    assert "ORDER BY _hq_result.`period` ASC" in statement


def test_bounds_and_filters_are_bound_parameters() -> None:
    compiled = plan_dataset_query(
        SALES,
        DatasetQuery(
            measures=("rolling7",),
            by="day",
            filters=(*JANUARY, filter.eq("channel", "web")),
        ),
    )
    assert "2026-01-01" not in compiled.sql
    assert "'web'" not in compiled.sql
    assert {"2026-01-01", "2026-02-01", "web"} <= {
        parameter.value for parameter in compiled.parameters.values()
    }


def test_shifts_and_formulas_over_them_plan_together() -> None:
    statement = sql("revenue", "lastWeek", "lastMonth", "weekOverWeek")
    assert re.search(r"_hq_shift_ranges\d+ AS", statement)
    assert "subtractMonths(" in statement


@pytest.mark.parametrize(
    ("measures", "query", "message"),
    [
        (("rolling7",), {"by": None}, 'require a supported "by" grain'),
        (("rolling7",), {"filters": ()}, "exactly one bounded time range"),
        (("rolling7",), {"filters": (filter.gte("soldAt", "2026-01-01"),)}, "bounded time range"),
        (("rolling7",), {"by": "month"}, 'must span whole "month" buckets'),
        (("lastWeek",), {"by": "month"}, 'Shift measure "lastWeek" must span whole "month"'),
        (
            ("rolling7",),
            {"filters": (filter.between("soldAt", "2026-02-01", "2026-01-01"),)},
            "non-empty and ordered",
        ),
        (("rolling7",), {"limit": 5}, "exceeds the effective result limit of 5"),
        (
            ("revenue", "rolling7"),
            {"having": (HavingCondition(measure="revenue", operator="gt", value=1),)},
            "Having is not supported",
        ),
    ],
)
def test_unplannable_window_queries_are_refused(
    measures: tuple[str, ...], query: dict[str, object], message: str
) -> None:
    with pytest.raises(CompiledQueryError, match=message):
        sql(*measures, **query)


def test_monthly_shifts_plan_at_a_daily_grain() -> None:
    # Calendar shifts keep the date; they never become a fixed number of days.
    assert "subtractMonths(" in sql("lastMonth")


def test_queries_without_time_measures_keep_the_plain_statement() -> None:
    assert not sql("revenue").startswith("WITH ")


def test_the_catalog_describes_windows_and_shifts() -> None:
    catalog = get_dataset_catalog(SALES, registry=create_dataset_registry(SALES))
    measures = catalog["measures"]
    assert measures["rolling7"] == {
        "aggregation": "sum",
        "field": "amount",
        "kind": "window",
        "measure": "revenue",
        "requiresTimeRange": True,
        "trailing": {"amount": 7, "unit": "day"},
        "filterCount": 0,
        # Seven days span whole buckets up to a week; the dataset has no minute grain.
        "supportedGrains": ["hour", "day", "week"],
    }
    assert measures["lastMonth"]["interval"] == {"amount": 1, "unit": "month"}
    derived = catalog["derivedMeasures"]["weekOverWeek"]
    assert derived["requiresTimeRange"] is True
    assert "rolling7" in catalog["orderableFields"]


def test_client_endpoints_and_deployment_leave_time_measures_out() -> None:
    _, measures, _ = public_fields(SALES, None, frozenset())
    assert set(measures) == {"revenue", "buyers"}
    with pytest.raises(ValueError, match="rolling7"):
        build_protocol_deployment_contract(create_dataset_registry(SALES))


def _restricted(**options: object) -> Dataset:
    return dataset(
        "sales",
        source="sales",
        time_key="sold_at",
        measures={"revenue": measure.sum("amount"), "rolling7": MEASURES["rolling7"]},
        **options,  # type: ignore[arg-type]
    )


@pytest.mark.parametrize(
    ("restricted", "message"),
    [
        (
            _restricted(
                dimensions={"soldAt": dimension.timestamp(column="sold_at", filterable=False)}
            ),
            "not exposed",
        ),
        (
            _restricted(
                dimensions={"soldAt": dimension.timestamp(column="sold_at")},
                filters={"soldAt": FilterDefinition(field="soldAt", operators=("eq",))},
            ),
            "does not allow gte",
        ),
    ],
)
def test_time_bounds_follow_the_datasets_filter_rules(restricted: Dataset, message: str) -> None:
    # A plain query refuses these filters; the window's time bounds must too.
    with pytest.raises(CompiledQueryError, match=message):
        plan_dataset_query(
            restricted, DatasetQuery(measures=("rolling7",), by="day", filters=JANUARY)
        )


@pytest.mark.parametrize(
    "wrapper", [measure.shift("latestStatus", 1, "day"), measure.trailing("latestStatus", 7, "day")]
)
def test_formulas_over_windows_and_shifts_need_numeric_inputs(wrapper: AnyMeasure) -> None:
    with pytest.raises(ValueError, match="numeric measure"):
        sales(
            latestStatus=measure.max("channel"),
            previous=wrapper,
            ratio=measure.derived(divide("previous", "revenue")),
        )


@pytest.mark.parametrize("metric", ["rolling7", "lastWeek", "weekOverWeek"])
def test_client_metrics_never_wrap_a_time_measure(metric: str) -> None:
    from hypequery.serve import add_metric_endpoint, create_api

    with pytest.raises(ValueError, match="window or shift"):
        export_client_contract(
            [ClientEndpointDefinition(SALES, "/metric", ClientQueryProfile(), measure=metric)]
        )
    api = create_api(auth=lambda credential: None)
    client = create_dataset_client(executor=_Executor())
    with pytest.raises(ValueError, match="window or shift"):
        add_metric_endpoint(
            api,
            "/metric",
            dataset=SALES,
            measure=metric,
            client=client,
            client_profile=ClientQueryProfile(),
        )
    # Without a client profile the request can carry the grain and range.
    add_metric_endpoint(api, "/plain", dataset=SALES, measure=metric, client=client)


def test_formulas_refuse_a_shift_of_a_merge_that_may_not_be_a_number() -> None:
    with pytest.raises(ValueError, match="numeric measure"):
        sales(
            stored=measure.merge("any", "stored_state"),
            previous=measure.shift("stored", 1, "day"),
            ratio=measure.derived(divide("previous", "revenue")),
        )
