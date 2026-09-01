from __future__ import annotations

import json
from collections.abc import Mapping
from copy import deepcopy
from typing import assert_type, cast

import pytest
from pydantic import JsonValue, ValidationError

from hypequery.datasets import (
    Aggregation,
    Dataset,
    DatasetLimits,
    Dimension,
    Filter,
    FormulaBinary,
    FormulaCall,
    Measure,
    Order,
    Relationship,
    add,
    arg_max,
    arg_min,
    asc,
    avg,
    belongs_to,
    between,
    ceil,
    coalesce,
    compile_formula,
    count,
    count_distinct,
    desc,
    dimension,
    divide,
    eq,
    floor,
    gt,
    gte,
    has_many,
    has_one,
    in_list,
    like,
    lt,
    lte,
    max,  # noqa: A004
    measure,
    median,
    min,  # noqa: A004
    multiply,
    neq,
    not_in_list,
    null_if_zero,
    percentile,
    round,  # noqa: A004
    stddev,
    subtract,
    sum,  # noqa: A004
    variance,
)
from hypequery.protocol import ProtocolExpression, ProtocolIdentifierError, expression_to_data


def _customers() -> Dataset:
    return Dataset(
        name="customers",
        source="customers",
        tenant_key="tenant_id",
        dimensions={
            "id": dimension("string"),
            "tenantId": dimension("string", column="tenant_id"),
            "name": dimension("string", label="Customer Name"),
        },
        measures={"customerCount": measure(count("id"))},
    )


def test_constructs_typescript_equivalent_logical_model() -> None:
    customers = _customers()
    target_calls = 0

    def customer_target() -> Dataset:
        nonlocal target_calls
        target_calls += 1
        return customers

    orders = Dataset(
        name="orders",
        source="orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={
            "id": dimension("string"),
            "tenantId": dimension("string", column="tenant_id"),
            "customerId": dimension("string", column="customer_id"),
            "status": dimension("string", label="Order Status"),
            "amount": dimension("number", label="Amount"),
            "createdAt": dimension("timestamp", column="created_at"),
        },
        measures={
            "revenue": measure(sum("amount")),
            "orderCount": measure(count("id")),
            "uniqueCustomers": measure(count_distinct("customerId")),
            "completedRevenue": measure(sum("amount"), filters=(eq("status", "completed"),)),
        },
        relationships={
            "customer": belongs_to(
                customer_target,
                from_field="customerId",
                to_field="id",
            )
        },
        limits=DatasetLimits(max_dimensions=5, max_filters=10),
    )

    assert target_calls == 1
    assert orders.relationships["customer"] == Relationship(
        kind="belongsTo",
        target="customers",
        from_field="customerId",
        to_field="id",
    )
    assert orders.measures["completedRevenue"].filters == (
        Filter(field="status", operator="eq", value="completed"),
    )
    assert set(orders.filters) == set(orders.dimensions)
    assert json.loads(orders.model_dump_json(exclude_none=True))["relationships"] == {
        "customer": {
            "kind": "belongsTo",
            "target": "customers",
            "from_field": "customerId",
            "to_field": "id",
        }
    }


def test_relationship_helpers_resolve_direct_and_callable_targets() -> None:
    customers = _customers()

    assert belongs_to(customers, from_field="customerId", to_field="id").kind == "belongsTo"
    assert has_many(lambda: customers, from_field="id", to_field="customerId").kind == "hasMany"
    assert has_one(lambda: customers, from_field="id", to_field="customerId").kind == "hasOne"


@pytest.mark.parametrize(
    ("definition", "aggregation", "arg_field", "level"),
    [
        (sum("amount"), "sum", None, None),
        (count("id"), "count", None, None),
        (count_distinct("customerId"), "countDistinct", None, None),
        (avg("amount"), "avg", None, None),
        (min("amount"), "min", None, None),
        (max("amount"), "max", None, None),
        (percentile("amount", 0.95), "percentile", None, 0.95),
        (median("amount"), "percentile", None, 0.5),
        (arg_max("amount", "createdAt"), "argMax", "createdAt", None),
        (arg_min("amount", "createdAt"), "argMin", "createdAt", None),
        (stddev("amount"), "stddev", None, None),
        (variance("amount"), "variance", None, None),
    ],
)
def test_aggregation_helpers(
    definition: Aggregation,
    aggregation: str,
    arg_field: str | None,
    level: float | None,
) -> None:
    assert definition.aggregation == aggregation
    assert definition.arg_field == arg_field
    assert definition.level == level


@pytest.mark.parametrize("level", [-0.1, 1.1, float("nan"), float("inf")])
def test_percentile_rejects_invalid_levels(level: float) -> None:
    with pytest.raises(ValidationError):
        percentile("amount", level)


def test_arg_aggregations_reject_filters_and_missing_by_field() -> None:
    with pytest.raises(ProtocolIdentifierError):
        arg_max("amount", "")
    with pytest.raises(ValidationError, match="filters are not supported"):
        measure(arg_min("amount", "createdAt"), filters=(eq("status", "complete"),))


def test_formula_helpers_build_serializable_symbolic_data() -> None:
    formula = round(
        coalesce(
            divide(add("revenue", 2), null_if_zero(subtract("orders", 1))),
            multiply("fallback", 3),
        ),
        2,
    )

    data = formula.model_dump(mode="json")
    assert data["kind"] == "call"
    assert data["name"] == "round"
    assert data["args"][0]["name"] == "coalesce"
    assert data["args"][0]["args"][0]["operator"] == "divide"
    assert floor("amount").name == "floor"
    assert ceil("amount").name == "ceil"
    assert isinstance(add("left", "right"), FormulaBinary)
    assert isinstance(null_if_zero("orders"), FormulaCall)
    json.dumps(data)


def test_formula_helpers_compile_to_portable_expression_ast() -> None:
    expression = compile_formula(round(divide("revenue", null_if_zero("orders")), 2))

    assert expression_to_data(expression) == {
        "kind": "call",
        "function": "round",
        "args": [
            {
                "kind": "binary",
                "operator": "divide",
                "left": {"kind": "reference", "name": "revenue"},
                "right": {
                    "kind": "call",
                    "function": "nullIfZero",
                    "args": [{"kind": "reference", "name": "orders"}],
                },
            },
            {"kind": "literal", "value": 2.0},
        ],
    }

    assert_type(compile_formula(add("revenue", 1)), ProtocolExpression)


def test_formula_compilation_rejects_inexact_integer_literals() -> None:
    with pytest.raises(ValueError, match="exactly representable"):
        compile_formula(2**53 + 1)

    assert expression_to_data(compile_formula(2**53)) == {
        "kind": "literal",
        "value": float(2**53),
    }


@pytest.mark.parametrize(
    "definition",
    [
        eq("status", "complete"),
        neq("status", "cancelled"),
        gt("amount", 1),
        gte("amount", 1),
        lt("amount", 10),
        lte("amount", 10),
        in_list("status", ["complete", "pending"]),
        not_in_list("status", ["cancelled"]),
        between("createdAt", "2026-01-01", "2026-02-01"),
        like("status", "comp%"),
    ],
)
def test_filter_helpers_return_strict_data(definition: Filter) -> None:
    json.dumps(definition.model_dump(mode="json"))


def test_order_helpers() -> None:
    assert asc("createdAt") == Order(field="createdAt", direction="asc")
    assert desc("customer.country") == Order(field="customer.country", direction="desc")


def test_non_filterable_dimensions_are_not_default_filters() -> None:
    dataset = Dataset(
        name="events",
        source="events",
        dimensions={
            "id": dimension("string"),
            "secret": dimension("string", filterable=False),
        },
    )

    assert set(dataset.filters) == {"id"}


@pytest.mark.parametrize(
    "model_input",
    [
        {"field_type": "number", "filterable": 1},
        {"field_type": "number", "unknown": True},
        {"field_type": "number", "dependencies": ["amount"]},
    ],
)
def test_dimension_rejects_coercions_unknown_fields_and_mutable_sequences(
    model_input: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        Dimension.model_validate(model_input)


@pytest.mark.parametrize(
    "model_input",
    [
        {"name": 123, "source": "orders", "dimensions": {}},
        {"name": "orders", "source": "orders", "dimensions": {}, "extra": True},
        {"name": "orders", "source": "orders", "dimensions": [], "filters": {}},
    ],
)
def test_dataset_rejects_coercions_unknown_fields_and_wrong_containers(
    model_input: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        Dataset.model_validate(model_input)


def test_definition_names_are_portable_identifiers() -> None:
    with pytest.raises(ProtocolIdentifierError):
        Dataset(name="bad-name", source="orders", dimensions={})
    with pytest.raises(ProtocolIdentifierError):
        Dataset(name="orders", source="orders", dimensions={"bad.name": dimension("string")})
    with pytest.raises(ValidationError, match="must not match"):
        Dataset(
            name="orders",
            source="orders",
            dimensions={"id": dimension("string")},
            relationships={
                "orders": Relationship(
                    kind="hasOne", target="customers", from_field="id", to_field="id"
                )
            },
        )


def test_filter_values_reject_functions_and_non_finite_numbers() -> None:
    def callback() -> str:
        return "complete"

    with pytest.raises(ValidationError):
        Filter.model_validate({"field": "status", "operator": "eq", "value": callback})
    with pytest.raises(ValidationError):
        Filter.model_validate({"field": "amount", "operator": "eq", "value": float("nan")})


def test_definition_containers_are_immutable_snapshots() -> None:
    dimensions = {"id": dimension("string")}
    dataset = Dataset(name="orders", source="orders", dimensions=dimensions)
    dimensions["late"] = dimension("string")

    assert set(dataset.dimensions) == {"id"}
    with pytest.raises(TypeError):
        cast(dict[str, Dimension], dataset.dimensions)["late"] = dimension("string")

    source_values: list[JsonValue] = ["complete", {"nested": [1, 2]}]
    definition = in_list("status", source_values)
    source_values.append("late")

    assert definition.model_dump(mode="json")["value"] == [
        "complete",
        {"nested": [1, 2]},
    ]
    with pytest.raises(AttributeError):
        cast(list[object], definition.value).append("late")
    frozen_object = cast(Mapping[str, object], cast(tuple[object, ...], definition.value)[1])
    with pytest.raises(AttributeError):
        cast(list[object], frozen_object["nested"]).append(3)


def test_immutable_definitions_support_deep_copy() -> None:
    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"id": dimension("string")},
    )
    definition = in_list("status", ["complete", {"nested": [1, 2]}])

    assert deepcopy(dataset) == dataset
    assert dataset.model_copy(deep=True) == dataset
    assert deepcopy(definition) == definition
    assert definition.model_copy(deep=True) == definition


def test_definition_update_copies_cannot_bypass_validation() -> None:
    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"id": dimension("string")},
    )
    definition = in_list("status", ["complete"])

    with pytest.raises(TypeError, match="construct a new validated model"):
        dataset.model_copy(update={"dimensions": {"late": dimension("string")}})
    with pytest.raises(TypeError, match="construct a new validated model"):
        definition.model_copy(update={"value": ["mutable"]})


def test_public_api_types_are_specific() -> None:
    customers = _customers()

    assert_type(dimension("number"), Dimension)
    assert_type(sum("amount"), Aggregation)
    assert_type(measure(sum("amount")), Measure)
    assert_type(eq("status", "complete"), Filter)
    assert_type(desc("amount"), Order)
    assert_type(belongs_to(customers, from_field="customerId", to_field="id"), Relationship)
    assert_type(divide("revenue", "orders"), FormulaBinary)
