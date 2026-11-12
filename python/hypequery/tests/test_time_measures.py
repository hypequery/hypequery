"""Window and shift measures (RFC 0015): validation, planning shape and projections.

Results are checked against ClickHouse in `test_clickhouse_features_live.py`.
"""

from __future__ import annotations

import re
from typing import Any, Never, cast

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
    serialize_semantic_contract,
)
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.client_contract.fields import public_fields
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.formulas import add, divide, null_if_zero
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


# -- composite shifts: a shift over a window, a formula or another shift -------

COMPOSITE = sales(
    aov=measure.derived(divide("revenue", null_if_zero("buyers"))),
    priorAov=measure.shift("aov", 1, "year"),
    priorRolling=measure.shift("rolling7", 1, "year"),
    priorRunning=measure.shift("running", 1, "year"),
    twice=measure.shift("priorAov", 1, "year"),
    growth=measure.derived(divide("aov", null_if_zero("priorAov"))),
)


def composite_sql(*measures: str, **query: object) -> str:
    fields: dict[str, object] = {"by": "day", "filters": JANUARY, **query}
    return plan_dataset_query(COMPOSITE, DatasetQuery(measures=measures, **fields)).sql  # type: ignore[arg-type]


def test_a_shift_may_wrap_any_measure() -> None:
    assert COMPOSITE.measures["twice"] == measure.shift("priorAov", 1, "year")
    # A window still wraps a base measure.
    with pytest.raises(ValueError, match="must wrap a base measure"):
        sales(nested=measure.trailing("lastWeek", 7, "day"))
    with pytest.raises(ValueError, match='references missing measure "absent"'):
        sales(prior=measure.shift("absent", 1, "year"))


@pytest.mark.parametrize(
    "measures",
    [
        {
            "current": measure.derived(divide("prior", 2)),
            "prior": measure.shift("current", 1, "year"),
        },
        {"loop": measure.shift("loop", 1, "year")},
        {"a": measure.shift("b", 1, "year"), "b": measure.shift("a", 1, "year")},
    ],
)
def test_mixed_shift_and_formula_cycles_are_rejected(measures: dict[str, AnyMeasure]) -> None:
    with pytest.raises(ValueError, match="dependency cycle"):
        sales(**measures)


def test_formulas_over_nested_shifts_still_need_numeric_inputs() -> None:
    with pytest.raises(ValueError, match="numeric measure"):
        sales(
            latestStatus=measure.max("channel"),
            previous=measure.shift("latestStatus", 1, "day"),
            twice=measure.shift("previous", 1, "day"),
            ratio=measure.derived(divide("twice", "revenue")),
        )


def test_flat_shifts_keep_the_flat_statement() -> None:
    statement = composite_sql("revenue", "lastWeek", "weekOverWeek")
    assert "_hq_context" not in statement
    assert "_hq_shift_ranges" in statement


def test_a_shifted_formula_evaluates_its_inputs_in_a_shifted_context() -> None:
    statement = composite_sql("aov", "priorAov")
    assert "_hq_context0 AS" in statement
    assert re.search(r"_hq_context1 AS \(SELECT p\._hq_period, subtractYears\(", statement)
    assert "FROM _hq_context0 AS p)" in statement
    # The ratio divides aggregates in each context, after both are joined on.
    assert len(re.findall(r"_hq_formula\d+ AS \(SELECT \*, ", statement)) == 2
    assert "_hq_scanned" not in statement


def test_shifts_of_shifts_chain_contexts_and_share_equal_ones() -> None:
    statement = composite_sql("twice", "priorAov", "priorRolling")
    # priorAov and priorRolling share one year-back context; twice adds a second.
    assert "FROM _hq_context1 AS p)" in statement
    assert "_hq_context3 AS" not in statement


def test_a_shifted_window_reads_whole_buckets_of_its_context() -> None:
    statement = composite_sql("priorRolling")
    assert re.search(r"_hq_ranges\d+ AS \(SELECT _hq_period, subtractDays\(_hq_eval_end", statement)
    # Cumulative history is looked up at each shifted bucket's end.
    cumulative = composite_sql("priorRunning", dimensions=("channel",))
    assert "LEFT ASOF JOIN" in cumulative
    assert "s.* EXCEPT (_hq_eval_end, _hq_partition)" in cumulative


def test_a_formula_over_a_formula_is_planned() -> None:
    statement = composite_sql("growth")
    assert "_hq_formula" in statement
    assert "`growth`" in statement


def test_composite_grains_check_every_wrapped_window() -> None:
    with pytest.raises(CompiledQueryError, match='"rolling7" must span whole "month"'):
        composite_sql("priorRolling", by="month")


def test_the_catalog_intersects_wrapper_and_dependency_grains() -> None:
    catalog = get_dataset_catalog(COMPOSITE, registry=create_dataset_registry(COMPOSITE))
    measures: dict[str, dict[str, object]] = dict(catalog["measures"])  # type: ignore[arg-type]
    assert measures["priorRolling"]["supportedGrains"] == ["hour", "day", "week"]
    # A shifted window inherits its base measure's aggregation; a shifted formula has none.
    assert measures["priorRolling"]["aggregation"] == "sum"
    assert "aggregation" not in measures["priorAov"]
    assert measures["twice"]["kind"] == "shift"
    assert catalog["derivedMeasures"]["growth"]["requiresTimeRange"] is True


def test_the_semantic_contract_serializes_shifted_formulas() -> None:
    contract = serialize_semantic_contract(create_dataset_registry(COMPOSITE))
    datasets = cast(dict[str, Any], contract["datasets"])
    measures = datasets["sales"]["measures"]
    assert measures["priorRolling"]["aggregation"] == "sum"
    # No base measure under a formula, so no aggregation or field, as in TypeScript.
    for name in ("priorAov", "twice"):
        assert "aggregation" not in measures[name]
        assert "field" not in measures[name]
        assert measures[name]["kind"] == "shift"
    assert contract["contentHash"] == (
        # The same dataset in TypeScript hashes identically.
        "ff605810697619f5b9fd3085ddc4e4d3e5e9bd5fc738f2c68536dbc46cde6dfa"
    )


def test_composite_graphs_are_capped_before_any_sql_is_built() -> None:
    # Each layer shifts the next by one and by two days, so contexts double per layer.
    layers: dict[str, AnyMeasure] = {}
    for layer in range(16):
        child = "revenue" if layer == 15 else f"layer{layer + 1}"
        layers[f"layer{layer}Day"] = measure.shift(child, 1, "day")
        layers[f"layer{layer}TwoDays"] = measure.shift(child, 2, "day")
        layers[f"layer{layer}"] = measure.derived(add(f"layer{layer}Day", f"layer{layer}TwoDays"))
    fanned = sales(**layers)
    with pytest.raises(CompiledQueryError, match="shifted contexts") as raised:
        plan_dataset_query(fanned, DatasetQuery(measures=("layer0",), by="day", filters=JANUARY))
    assert raised.value.failure.category == "input-invalid"
    # A shallow stack still plans.
    plan_dataset_query(fanned, DatasetQuery(measures=("layer14",), by="day", filters=JANUARY))


def test_formulas_refuse_a_shift_of_a_merge_that_may_not_be_a_number() -> None:
    with pytest.raises(ValueError, match="numeric measure"):
        sales(
            stored=measure.merge("any", "stored_state"),
            previous=measure.shift("stored", 1, "day"),
            ratio=measure.derived(divide("previous", "revenue")),
        )


def test_window_and_shift_measures_annotate_with_label_and_description_only() -> None:
    """Client contracts advertise vocabulary only for fields that declare it."""
    from hypequery.datasets.client_contract.annotations import field_annotation

    window = measure.trailing(
        "revenue", 7, "day", label="Rolling revenue", description="  Last\n 7 days  "
    )
    shift = measure.shift("revenue", 7, "day", label="Revenue a week ago")

    assert field_annotation(window) == {
        "label": "Rolling revenue",
        "description": "Last 7 days",
    }
    assert field_annotation(shift) == {"label": "Revenue a week ago"}
    assert field_annotation(measure.cumulative("revenue")) is None
