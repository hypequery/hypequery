from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolCallExpression,
    ProtocolDatasetQuery,
    ProtocolExpressionError,
    ProtocolExpressionLimits,
    ProtocolLiteralExpression,
    expression_to_data,
    semantic_query_to_data,
    validate_protocol_expression,
    validate_protocol_semantic_query,
)


def _literal(value: object = False) -> dict[str, object]:
    return {"kind": "literal", "value": value}


def _predicate(wrappers: int = 0) -> dict[str, object]:
    value: dict[str, object] = {
        "kind": "comparison",
        "operator": "eq",
        "left": {"kind": "reference", "name": "status"},
        "right": {"kind": "literal", "value": "paid"},
    }
    for _ in range(wrappers):
        value = {"kind": "logical", "operator": "not", "operand": value}
    return value


def _expect_code(value: object, code: str) -> None:
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_expression(value)
    assert raised.value.code == code
    assert repr(value) not in str(raised.value)


def test_validates_and_serializes_immutable_detached_expression_models() -> None:
    source = {
        "kind": "call",
        "function": "coalesce",
        "args": [
            {"kind": "reference", "name": "revenue"},
            {
                "kind": "literal",
                "value": {
                    "$hypequery": {
                        "type": "array",
                        "version": 1,
                        "values": ["fallback"],
                    }
                },
            },
        ],
    }

    expression = validate_protocol_expression(source)
    assert isinstance(expression, ProtocolCallExpression)
    cast(dict[str, object], cast(list[object], source["args"])[0])["name"] = "changed"

    data = expression_to_data(expression)
    assert cast(dict[str, object], cast(list[object], data["args"])[0])["name"] == "revenue"
    literal = cast(ProtocolLiteralExpression, expression.args[1])
    frozen_value = cast(object, literal.value)
    with pytest.raises(TypeError):
        cast(dict[str, object], frozen_value)["late"] = True


def test_semantic_query_model_preserves_absent_and_empty_collections() -> None:
    query = validate_protocol_semantic_query(
        {
            "kind": "dataset",
            "dataset": "orders",
            "dimensions": [],
            "filters": [_predicate()],
            "orderBy": [{"field": "customer.country", "direction": "asc"}],
            "limit": 0,
            "includeMeta": False,
        }
    )

    assert isinstance(query, ProtocolDatasetQuery)
    assert query.dimensions == ()
    assert query.measures is None
    assert semantic_query_to_data(query) == {
        "kind": "dataset",
        "dataset": "orders",
        "dimensions": [],
        "filters": [_predicate()],
        "orderBy": [{"field": "customer.country", "direction": "asc"}],
        "limit": 0,
        "includeMeta": False,
    }


@pytest.mark.parametrize("level", [0, 1, 0.0, 1.0])
def test_percentile_level_preserves_numeric_representation(level: int | float) -> None:
    source = {
        "kind": "aggregate",
        "aggregation": "percentile",
        "field": "amount",
        "level": level,
    }

    data = expression_to_data(validate_protocol_expression(source))
    assert data == source
    assert type(data["level"]) is type(level)


def test_depth_boundary_matches_standalone_and_query_predicates() -> None:
    accepted = _predicate(14)
    rejected = _predicate(15)

    validate_protocol_expression(accepted)
    validate_protocol_semantic_query(
        {"kind": "dataset", "dataset": "orders", "filters": [accepted]}
    )
    _expect_code(rejected, "HQ_EXPRESSION_TOO_DEEP")
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_semantic_query(
            {"kind": "dataset", "dataset": "orders", "filters": [rejected]}
        )
    assert raised.value.code == "HQ_EXPRESSION_TOO_DEEP"


def test_limits_may_be_lowered_but_not_raised() -> None:
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_expression(
            {"kind": "logical", "operator": "and", "operands": [_literal(), _literal()]},
            limits=ProtocolExpressionLimits(max_collection_items=1),
        )
    assert raised.value.code == "HQ_EXPRESSION_TOO_MANY_ITEMS"

    with pytest.raises(ValueError, match="protocol v1 maximum"):
        ProtocolExpressionLimits(max_nodes=1_001)


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError(f"accessed {key}")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("iterated")

    def __len__(self) -> int:
        raise AssertionError("measured")


def test_rejects_host_objects_and_cycles_without_invoking_hooks() -> None:
    _expect_code(_HostileMapping(), "HQ_EXPRESSION_UNSAFE_OBJECT")

    cyclic: dict[str, object] = {"kind": "logical", "operator": "not"}
    cyclic["operand"] = cyclic
    _expect_code(cyclic, "HQ_EXPRESSION_UNSAFE_OBJECT")

    operands: list[object] = []
    operands.extend((operands, _literal()))
    _expect_code(
        {"kind": "logical", "operator": "and", "operands": operands},
        "HQ_EXPRESSION_UNSAFE_OBJECT",
    )


@pytest.mark.parametrize(
    ("value", "code"),
    [
        ({"kind": "sql", "value": "select 1"}, "HQ_EXPRESSION_UNKNOWN_KIND"),
        (
            {"kind": "call", "function": "eval", "args": [_literal()]},
            "HQ_EXPRESSION_INVALID_OPERATOR",
        ),
        (
            {"kind": "dataset", "dataset": "orders"},
            "HQ_EXPRESSION_UNKNOWN_KIND",
        ),
    ],
)
def test_expression_surface_fails_closed(value: object, code: str) -> None:
    _expect_code(value, code)
