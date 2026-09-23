"""The semantic planner and the RFC 0010 compiled query.

These pin the two things a planner is for: the statement it emits is the one
the dataset describes, and nothing a caller sends reaches that statement as
text. The second is also checked mechanically by
`scripts/check_sql_interpolation.py`; the cases here are the ones worth reading.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

import pytest

from hypequery.datasets import Dataset, count, dimension, measure
from hypequery.datasets import sum as sum_
from hypequery.datasets.dataset import DatasetLimits, FilterDefinition
from hypequery.datasets.dimensions import Dimension
from hypequery.datasets.measures import Measure
from hypequery.datasets.planner import (
    CompiledQueryError,
    DatasetQuery,
    Deadline,
    ExecutionContext,
    all_tenants,
    effective_deadline,
    plan_dataset_query,
    query_settings,
    tenant,
    tenants,
)
from hypequery.datasets.planner.planner import BASE_ALIAS
from hypequery.datasets.query_helpers import Filter, asc, desc, eq, gte, in_list, like
from hypequery.datasets.registry import DatasetRegistry, create_dataset_registry
from hypequery.datasets.relationships import Relationship, belongs_to, has_many


def _customers(*, tenant_key: str | None = None) -> Dataset:
    return Dataset(
        name="customers",
        source="analytics.customers",
        tenant_key=tenant_key,
        dimensions={"country": dimension("string"), "tier": dimension("string")},
        measures={},
    )


def _trips(
    *,
    time_key: str | None = "pickup_datetime",
    tenant_key: str | None = None,
    dimensions: Mapping[str, Dimension] | None = None,
    measures: Mapping[str, Measure] | None = None,
    filters: Mapping[str, FilterDefinition] | None = None,
    relationships: Mapping[str, Relationship] | None = None,
    limits: DatasetLimits | None = None,
) -> Dataset:
    return Dataset(
        name="trips",
        source="analytics.trips",
        time_key=time_key,
        tenant_key=tenant_key,
        dimensions=dimensions
        if dimensions is not None
        else {
            "vendor": dimension("string"),
            "fare": dimension("number"),
            "pickup": dimension("timestamp", column="pickup_datetime"),
            "surge": dimension("number", sql="fare * 1.5"),
        },
        measures=measures
        if measures is not None
        else {"trips": measure(count("id")), "revenue": measure(sum_("total_amount"))},
        filters=filters
        if filters is not None
        else {
            "vendor": FilterDefinition(field="vendor"),
            "fare": FilterDefinition(field="fare"),
            "pickup": FilterDefinition(field="pickup"),
        },
        relationships=relationships or {},
        limits=limits,
    )


def _related() -> tuple[Dataset, Dataset]:
    customers = _customers()
    trips = _trips(
        dimensions={"vendor": dimension("string"), "customer_id": dimension("string")},
        relationships={
            "customer": belongs_to(customers, from_field="customer_id", to_field="id"),
            "receipts": has_many(customers, from_field="id", to_field="trip_id"),
        },
    )
    return trips, customers


def _category(
    dataset: Dataset,
    query: DatasetQuery,
    *,
    registry: DatasetRegistry | None = None,
    context: ExecutionContext | None = None,
) -> str:
    """The category a rejected plan reports."""

    with pytest.raises(CompiledQueryError) as caught:
        plan_dataset_query(dataset, query, registry=registry, context=context)
    return caught.value.category


def test_a_plain_aggregation_selects_groups_and_aliases() -> None:
    compiled = plan_dataset_query(
        _trips(), DatasetQuery(dimensions=("vendor",), measures=("trips",))
    )
    assert compiled.sql == (
        "SELECT `vendor` AS `vendor`, count(`id`) AS `trips` "
        "FROM `analytics`.`trips` GROUP BY `vendor`"
    )
    assert compiled.operation == "query"
    assert compiled.parameters == {}


def test_omitting_measures_selects_every_measure() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(dimensions=("vendor",)))
    assert "count(`id`) AS `trips`" in compiled.sql
    assert "sum(`total_amount`) AS `revenue`" in compiled.sql


def test_a_dimension_column_override_is_used() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(dimensions=("pickup",)))
    assert "`pickup_datetime` AS `pickup`" in compiled.sql


def test_a_time_grain_selects_and_orders_by_period() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(by="month", measures=("trips",)))
    assert "toStartOfMonth(`pickup_datetime`) AS `period`" in compiled.sql
    assert compiled.sql.endswith("GROUP BY `period` ORDER BY `period` ASC")


def test_a_time_grain_needs_a_time_key() -> None:
    assert _category(_trips(time_key=None), DatasetQuery(by="day")) == "input-invalid"


def test_an_unsupported_time_grain_is_refused() -> None:
    assert _category(_trips(), DatasetQuery(by="fortnight")) == "input-invalid"


def test_a_sql_backed_dimension_keeps_its_expression_inside_one_operand() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(dimensions=("surge",)))
    assert "(fare * 1.5\n) AS `surge`" in compiled.sql


@pytest.mark.parametrize(
    "expression",
    [
        # A trailing line comment would otherwise swallow every clause after it
        # on the one line the statement is built on — alias, FROM, and WHERE.
        "fare -- note",
        # A top-level OR would otherwise rebind across the AND joining predicates.
        "fare = 1 OR 1 = 1",
    ],
)
def test_a_trusted_expression_cannot_reach_past_its_own_operand(expression: str) -> None:
    dataset = _trips(
        dimensions={"vendor": dimension("string"), "surge": dimension("number", sql=expression)},
        tenant_key="tenant_id",
        filters={},
    )
    compiled = plan_dataset_query(
        dataset,
        DatasetQuery(dimensions=("surge",), measures=("trips",)),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert f"({expression}\n)" in compiled.sql
    # The clauses after the expression, the tenant predicate above all, survive.
    assert "FROM `analytics`.`trips`" in compiled.sql
    assert "WHERE `tenant_id` = {p0:String}" in compiled.sql


def test_a_trusted_measure_expression_is_contained_too() -> None:
    dataset = _trips(
        dimensions={"vendor": dimension("string")},
        measures={"revenue": measure(sum_("total_amount"), sql="amount -- note")},
        tenant_key="tenant_id",
        filters={},
    )
    compiled = plan_dataset_query(
        dataset,
        DatasetQuery(measures=("revenue",)),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert "sum((amount -- note\n))" in compiled.sql
    assert "WHERE `tenant_id` = {p0:String}" in compiled.sql


def test_pagination_renders_from_bounded_integers() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(measures=("trips",), limit=50, offset=10))
    assert compiled.sql.endswith(" LIMIT 50 OFFSET 10")


def test_a_query_selecting_nothing_is_refused() -> None:
    assert _category(_trips(measures={}), DatasetQuery()) == "input-invalid"


@pytest.mark.parametrize(
    "query",
    [
        DatasetQuery(dimensions=("nope",)),
        DatasetQuery(measures=("nope",)),
        DatasetQuery(filters=(eq("nope", 1),)),
        DatasetQuery(measures=("trips",), order_by=(asc("vendor"),)),
    ],
)
def test_an_unresolvable_name_is_caller_input(query: DatasetQuery) -> None:
    assert _category(_trips(), query) == "input-invalid"


def test_a_relationship_qualified_measure_is_refused() -> None:
    trips, customers = _related()
    assert (
        _category(
            trips,
            DatasetQuery(measures=("customer.revenue",)),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


# --- values ---------------------------------------------------------------


def test_every_filter_value_becomes_a_parameter() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(
            measures=("trips",),
            filters=(
                eq("vendor", "yellow"),
                gte("fare", 10),
                in_list("vendor", ["a", "b"]),
                Filter(field="fare", operator="between", value=[1, 2]),
            ),
        ),
    )
    assert compiled.parameter_values() == {
        "p0": "yellow",
        "p1": 10.0,
        "p2": ["a", "b"],
        "p3": 1.0,
        "p4": 2.0,
    }
    assert "'yellow'" not in compiled.sql


def test_a_declared_dimension_type_chooses_the_parameter_type() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(
            measures=("trips",),
            filters=(eq("vendor", "yellow"), eq("fare", 3), eq("pickup", "2026-01-01")),
        ),
    )
    types = {name: parameter.clickhouse_type for name, parameter in compiled.parameters.items()}
    assert types == {"p0": "String", "p1": "Float64", "p2": "DateTime64(3)"}


def test_a_list_binds_as_one_array_rather_than_a_rendered_list() -> None:
    compiled = plan_dataset_query(
        _trips(), DatasetQuery(measures=("trips",), filters=(in_list("vendor", ["a", "b", "c"]),))
    )
    assert "IN {p0:Array(String)}" in compiled.sql
    assert compiled.parameter_values() == {"p0": ["a", "b", "c"]}


def test_the_statement_does_not_depend_on_the_value() -> None:
    def sql_for(value: str) -> str:
        return plan_dataset_query(
            _trips(), DatasetQuery(measures=("trips",), filters=(eq("vendor", value),))
        ).sql

    assert sql_for("yellow") == sql_for("' OR 1=1 --")


@pytest.mark.parametrize(
    ("operator", "value"),
    [("in", []), ("between", [1]), ("like", 5), ("eq", {"a": 1}), ("in", "abc")],
)
def test_a_value_of_the_wrong_shape_is_refused(operator: str, value: object) -> None:
    query = DatasetQuery(
        measures=("trips",),
        filters=(Filter(field="vendor", operator=operator, value=value),),  # type: ignore[arg-type]
    )
    assert _category(_trips(), query) == "input-invalid"


@pytest.mark.parametrize(
    "filter_value",
    [eq("fare", "not-a-number"), Filter(field="fare", operator="like", value="1%")],
)
def test_filter_values_must_match_the_declared_dimension_type(filter_value: Filter) -> None:
    assert (
        _category(_trips(), DatasetQuery(measures=("trips",), filters=(filter_value,)))
        == "input-invalid"
    )


def test_a_request_cannot_filter_on_an_unexposed_dimension() -> None:
    dataset = _trips(filters={"vendor": FilterDefinition(field="vendor")})
    assert (
        _category(dataset, DatasetQuery(measures=("trips",), filters=(eq("fare", 1),)))
        == "input-invalid"
    )


def test_an_explicit_filter_overrides_a_non_filterable_default() -> None:
    dataset = _trips(
        dimensions={"secret": dimension("string", filterable=False)},
        filters={"secret": FilterDefinition(field="secret")},
    )
    result = plan_dataset_query(
        dataset, DatasetQuery(measures=("trips",), filters=(eq("secret", "x"),))
    )
    assert result.parameters["p0"].value == "x"


def test_a_request_cannot_use_an_undeclared_filter_operator() -> None:
    dataset = _trips(filters={"fare": FilterDefinition(field="fare", operators=("eq",))})
    assert (
        _category(
            dataset,
            DatasetQuery(measures=("trips",), filters=(gte("fare", 1),)),
        )
        == "input-invalid"
    )


# --- relationships --------------------------------------------------------


def test_a_qualified_field_adds_one_left_join() -> None:
    trips, customers = _related()
    compiled = plan_dataset_query(
        trips,
        DatasetQuery(dimensions=("customer.country", "customer.tier"), measures=("trips",)),
        registry=create_dataset_registry(trips, customers),
    )
    assert compiled.sql.count("LEFT JOIN") == 1
    assert (
        "LEFT JOIN `analytics`.`customers` AS `customer` "
        f"ON {BASE_ALIAS.sql}.`customer_id` = `customer`.`id`" in compiled.sql
    )
    assert "`customer`.`country` AS `customer.country`" in compiled.sql


def test_base_columns_are_qualified_only_when_a_join_is_present() -> None:
    trips, customers = _related()
    registry = create_dataset_registry(trips, customers)
    plain = plan_dataset_query(trips, DatasetQuery(dimensions=("vendor",)), registry=registry)
    joined = plan_dataset_query(
        trips, DatasetQuery(dimensions=("vendor", "customer.country")), registry=registry
    )
    assert "`vendor` AS `vendor`" in plain.sql
    assert BASE_ALIAS.sql not in plain.sql
    assert f"{BASE_ALIAS.sql}.`vendor` AS `vendor`" in joined.sql


def test_a_has_many_relationship_cannot_be_joined() -> None:
    trips, customers = _related()
    assert (
        _category(
            trips,
            DatasetQuery(dimensions=("receipts.country",)),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


def test_more_than_one_hop_is_refused() -> None:
    trips, customers = _related()
    assert (
        _category(
            trips,
            DatasetQuery(dimensions=("customer.company.name",)),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


def test_a_sql_backed_field_cannot_be_combined_with_a_join() -> None:
    customers = _customers()
    trips = _trips(
        dimensions={
            "vendor": dimension("string"),
            "customer_id": dimension("string"),
            "surge": dimension("number", sql="fare * 1.5"),
        },
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
        filters={},
    )
    assert (
        _category(
            trips,
            DatasetQuery(dimensions=("surge", "customer.country")),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


def test_a_non_groupable_base_dimension_is_refused() -> None:
    dataset = _trips(dimensions={"secret": dimension("string", groupable=False)})
    assert _category(dataset, DatasetQuery(dimensions=("secret",), measures=())) == "input-invalid"


def test_a_non_groupable_related_dimension_is_refused() -> None:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"secret": dimension("string", groupable=False)},
    )
    trips = _trips(
        dimensions={"customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )
    assert (
        _category(
            trips,
            DatasetQuery(dimensions=("customer.secret",), measures=()),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


def test_a_non_filterable_related_dimension_is_refused() -> None:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"secret": dimension("string", filterable=False)},
    )
    trips = _trips(
        dimensions={"customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )
    assert (
        _category(
            trips,
            DatasetQuery(measures=("trips",), filters=(eq("customer.secret", "x"),)),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


def test_an_explicit_related_filter_overrides_a_non_filterable_default() -> None:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"secret": dimension("string", filterable=False)},
        filters={"secret": FilterDefinition(field="secret", operators=("eq",))},
    )
    trips = _trips(
        dimensions={"customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )
    result = plan_dataset_query(
        trips,
        DatasetQuery(measures=("trips",), filters=(eq("customer.secret", "x"),)),
        registry=create_dataset_registry(trips, customers),
    )
    assert result.parameters["p0"].value == "x"


def test_a_related_filter_must_be_exposed_by_the_target_dataset() -> None:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"secret": dimension("string"), "tier": dimension("string")},
        filters={"tier": FilterDefinition(field="tier")},
    )
    trips = _trips(
        dimensions={"customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )
    registry = create_dataset_registry(trips, customers)

    assert (
        _category(
            trips,
            DatasetQuery(measures=("trips",), filters=(eq("customer.secret", "known"),)),
            registry=registry,
        )
        == "input-invalid"
    )
    plan_dataset_query(
        trips,
        DatasetQuery(measures=("trips",), filters=(eq("customer.tier", "gold"),)),
        registry=registry,
    )


def test_a_related_filter_honors_the_target_operator_set() -> None:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"tier": dimension("string")},
        filters={"tier": FilterDefinition(field="tier", operators=("eq",))},
    )
    trips = _trips(
        dimensions={"customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )

    assert (
        _category(
            trips,
            DatasetQuery(measures=("trips",), filters=(like("customer.tier", "%"),)),
            registry=create_dataset_registry(trips, customers),
        )
        == "input-invalid"
    )


# --- tenancy --------------------------------------------------------------


def test_a_tenant_scoped_dataset_is_not_served_without_proof() -> None:
    assert _category(_trips(tenant_key="tenant_id"), DatasetQuery(measures=("trips",))) == (
        "tenant-required"
    )


def test_a_proven_tenant_becomes_a_bound_predicate() -> None:
    compiled = plan_dataset_query(
        _trips(tenant_key="tenant_id"),
        DatasetQuery(measures=("trips",)),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert "WHERE `tenant_id` = {p0:String}" in compiled.sql
    assert compiled.parameter_values() == {"p0": "acme"}


@pytest.mark.parametrize(
    "tenant_dimension",
    [dimension("string", column="public_tag"), dimension("string", sql="'acme'")],
)
def test_tenant_predicate_always_uses_the_physical_key(tenant_dimension: Dimension) -> None:
    dataset = _trips(
        tenant_key="tenant_id",
        dimensions={"tenant_id": tenant_dimension, "vendor": dimension("string")},
    )
    compiled = plan_dataset_query(
        dataset,
        DatasetQuery(measures=("trips",)),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert "WHERE `tenant_id` = {p0:String}" in compiled.sql
    assert "public_tag" not in compiled.sql
    assert "'acme'" not in compiled.sql


def test_sql_backed_filter_cannot_widen_the_tenant_scope() -> None:
    dataset = _trips(
        tenant_key="tenant_id",
        dimensions={"active_or_public": dimension("boolean", sql="active OR is_public")},
        filters={"active_or_public": FilterDefinition(field="active_or_public")},
    )
    compiled = plan_dataset_query(
        dataset,
        DatasetQuery(measures=("trips",), filters=(eq("active_or_public", True),)),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert "WHERE (active OR is_public\n) = {p0:Bool} AND `tenant_id` = {p1:String}" in (
        compiled.sql
    )


def test_a_tenant_set_binds_as_an_array() -> None:
    compiled = plan_dataset_query(
        _trips(tenant_key="tenant_id"),
        DatasetQuery(measures=("trips",)),
        context=ExecutionContext(tenant=tenants(("acme", "globex"))),
    )
    assert "WHERE `tenant_id` IN {p0:Array(String)}" in compiled.sql


def test_a_cross_tenant_scope_adds_no_predicate() -> None:
    compiled = plan_dataset_query(
        _trips(tenant_key="tenant_id"),
        DatasetQuery(measures=("trips",)),
        context=ExecutionContext(tenant=all_tenants()),
    )
    assert "WHERE" not in compiled.sql


def test_a_caller_cannot_filter_the_tenant_field() -> None:
    assert (
        _category(
            _trips(tenant_key="tenant_id"),
            DatasetQuery(measures=("trips",), filters=(eq("tenant_id", "other"),)),
            context=ExecutionContext(tenant=tenant("acme")),
        )
        == "input-invalid"
    )


def test_a_caller_cannot_filter_a_joined_target_tenant_field() -> None:
    """A relationship hop is not a way around the tenant-filter rule.

    The predicates would merely contradict and return nothing, which is a worse
    answer than refusing: the caller cannot tell an empty result from a request
    they were never allowed to make. The reference implementation refuses it,
    so this does too.
    """

    customers = Dataset(
        name="customers",
        source="analytics.customers",
        tenant_key="tenant_id",
        dimensions={
            "country": dimension("string"),
            "tenantId": dimension("string", column="tenant_id"),
        },
        measures={},
        filters={"tenantId": FilterDefinition(field="tenantId")},
    )
    trips = _trips(
        tenant_key="tenant_id",
        dimensions={"vendor": dimension("string"), "customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
        filters={},
    )
    assert (
        _category(
            trips,
            DatasetQuery(measures=("trips",), filters=(eq("customer.tenantId", "other"),)),
            registry=create_dataset_registry(trips, customers),
            context=ExecutionContext(tenant=tenant("acme")),
        )
        == "input-invalid"
    )


def test_a_joined_target_without_tenancy_is_filterable() -> None:
    """The guard asks about the owning dataset, not about qualification itself."""

    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"tier": dimension("string")},
        measures={},
        filters={"tier": FilterDefinition(field="tier")},
    )
    trips = _trips(
        tenant_key="tenant_id",
        dimensions={"vendor": dimension("string"), "customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
        filters={},
    )
    compiled = plan_dataset_query(
        trips,
        DatasetQuery(measures=("trips",), filters=(eq("customer.tier", "gold"),)),
        registry=create_dataset_registry(trips, customers),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert "`customer`.`tier` = " in compiled.sql


def test_a_join_propagates_the_tenant_predicate_into_its_condition() -> None:
    customers = _customers(tenant_key="tenant_id")
    trips = _trips(
        tenant_key="tenant_id",
        dimensions={"vendor": dimension("string"), "customer_id": dimension("string")},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
        filters={},
    )
    compiled = plan_dataset_query(
        trips,
        DatasetQuery(dimensions=("customer.country",), measures=("trips",)),
        registry=create_dataset_registry(trips, customers),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    # In the join condition, not in WHERE: a WHERE predicate on the right side
    # of a LEFT JOIN quietly turns it into an inner join.
    assert "ON `__hq_base`.`customer_id` = `customer`.`id` AND `customer`.`tenant_id` = " in (
        compiled.sql
    )
    assert compiled.parameter_values() == {"p0": "acme", "p1": "acme"}


def test_a_tenant_scope_is_not_a_pydantic_model() -> None:
    # The point of the type, not an accident of it: FastAPI cannot build one
    # from a request body, so a caller cannot hand itself a tenant.
    from pydantic import BaseModel

    from hypequery.datasets.planner import TenantScope

    assert not issubclass(TenantScope, BaseModel)


# --- limits, settings, deadline, cancellation -----------------------------


@pytest.mark.parametrize(
    ("limits", "query"),
    [
        (DatasetLimits(max_dimensions=1), DatasetQuery(dimensions=("vendor", "fare"))),
        (DatasetLimits(max_measures=1), DatasetQuery(measures=("trips", "revenue"))),
        (
            DatasetLimits(max_filters=1),
            DatasetQuery(measures=("trips",), filters=(eq("vendor", "a"), eq("fare", 1))),
        ),
        (DatasetLimits(max_result_size=10), DatasetQuery(measures=("trips",), limit=11)),
    ],
)
def test_dataset_limits_report_too_large(limits: DatasetLimits, query: DatasetQuery) -> None:
    assert _category(_trips(limits=limits), query) == "too-large"


def test_implicit_measures_still_count_against_the_dataset_limit() -> None:
    assert _category(_trips(limits=DatasetLimits(max_measures=1)), DatasetQuery()) == "too-large"


def test_missing_limit_is_bounded_by_the_dataset_result_ceiling() -> None:
    compiled = plan_dataset_query(
        _trips(limits=DatasetLimits(max_result_size=10)),
        DatasetQuery(measures=("trips",)),
    )
    assert compiled.sql.endswith("LIMIT 10")


def test_settings_default_to_the_conservative_end() -> None:
    compiled = plan_dataset_query(_trips(), DatasetQuery(measures=("trips",)))
    assert compiled.settings["readonly"] == 1
    assert compiled.settings.max_execution_time == 30


def test_a_setting_outside_its_range_is_refused() -> None:
    with pytest.raises(CompiledQueryError) as caught:
        query_settings(max_execution_time=100_000)
    assert caught.value.category == "internal"
    with pytest.raises(CompiledQueryError):
        query_settings(readonly=2)
    with pytest.raises(CompiledQueryError):
        query_settings(not_a_setting=1)


def test_a_caller_deadline_can_shorten_but_not_extend_the_window() -> None:
    settings = query_settings(max_execution_time=10)
    shorter = effective_deadline(Deadline.after(2), settings.max_execution_time)
    longer = effective_deadline(Deadline.after(1_000), settings.max_execution_time)
    assert shorter.remaining() < 3
    assert longer.remaining() <= 10


def test_an_expired_deadline_fails_before_anything_is_built() -> None:
    assert (
        _category(
            _trips(),
            DatasetQuery(measures=("trips",)),
            context=ExecutionContext(deadline=Deadline.after(-1)),
        )
        == "deadline-exceeded"
    )


class _Cancelled:
    def is_set(self) -> bool:
        return True


def test_caller_cancellation_outranks_an_expired_deadline() -> None:
    assert (
        _category(
            _trips(),
            DatasetQuery(measures=("trips",)),
            context=ExecutionContext(cancellation=_Cancelled(), deadline=Deadline.after(-1)),
        )
        == "aborted"
    )


# --- identity and the debug form ------------------------------------------


def test_each_compiled_query_carries_its_own_identifier() -> None:
    first = plan_dataset_query(_trips(), DatasetQuery(measures=("trips",)))
    second = plan_dataset_query(_trips(), DatasetQuery(measures=("trips",)))
    assert first.query_id != second.query_id
    assert len(first.query_id) == 32


def test_a_correlation_identifier_stays_separate_from_the_query_identifier() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(measures=("trips",)),
        context=ExecutionContext(correlation_id="trace-1"),
    )
    assert compiled.correlation_id == "trace-1"
    assert compiled.query_id != "trace-1"


@pytest.mark.parametrize(
    ("value", "category"),
    [("with\nnewline", "input-invalid"), ("a" * 1_025, "too-large")],
)
def test_a_correlation_identifier_is_bounded(value: str, category: str) -> None:
    assert (
        _category(
            _trips(),
            DatasetQuery(measures=("trips",)),
            context=ExecutionContext(correlation_id=value),
        )
        == category
    )


def test_the_debug_form_carries_no_value_and_no_bindable_placeholder() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(measures=("trips",), filters=(eq("vendor", "yellow"),)),
    )
    debug = compiled.to_sql()
    assert "yellow" not in debug
    # No `{name:Type}` left anywhere, so no driver will bind the debug form.
    assert "{" not in debug
    assert "<p0:String>" in debug


def test_the_log_description_names_types_but_never_values() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(measures=("trips",), filters=(eq("vendor", "yellow"),)),
    )
    description = compiled.describe()
    assert description["parameters"] == {"p0": "String"}
    assert "yellow" not in repr(description)


def test_a_server_fault_message_is_not_the_one_it_was_given() -> None:
    error = CompiledQueryError("internal", "connection to 10.0.0.4 refused as user=admin")
    assert "10.0.0.4" not in error.message
    assert error.failure.to_data()["message"] == "The query could not be executed."


def test_a_client_fault_message_is_kept() -> None:
    error = CompiledQueryError("input-invalid", 'Unknown dimension "nope".')
    assert error.message == 'Unknown dimension "nope".'


def test_ordering_follows_the_selected_aliases() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(dimensions=("vendor",), measures=("revenue",), order_by=(desc("revenue"),)),
    )
    assert compiled.sql.endswith("ORDER BY `revenue` DESC")


def test_a_reserved_base_alias_cannot_be_shadowed() -> None:
    dataset = _trips(
        dimensions={BASE_ALIAS.name: dimension("string"), "vendor": dimension("string")},
        filters={},
    )
    assert _category(dataset, DatasetQuery(dimensions=("vendor",))) == "internal"


def test_the_interpolation_check_script_passes() -> None:
    # The same gate CI runs, so a regression fails here first.
    script = Path(__file__).resolve().parents[1] / "scripts" / "check_sql_interpolation.py"
    completed = subprocess.run(
        [sys.executable, str(script)], capture_output=True, text=True, check=False
    )
    assert completed.returncode == 0, completed.stderr
