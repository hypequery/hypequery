"""Immutable RFC 0003 expression and semantic-query values."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, fields
from dataclasses import field as dataclass_field
from types import MappingProxyType
from typing import Literal, TypeAlias, cast

from .identifiers import ProtocolIdentifier, ProtocolQualifiedIdentifier
from .values import CanonicalValue

ProtocolBinaryOperator: TypeAlias = Literal["add", "subtract", "multiply", "divide"]
ProtocolFunctionName: TypeAlias = Literal["nullIfZero", "coalesce", "round", "floor", "ceil"]
ProtocolComparisonOperator: TypeAlias = Literal[
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between", "like"
]
ProtocolAggregation: TypeAlias = Literal[
    "sum",
    "count",
    "countDistinct",
    "avg",
    "min",
    "max",
    "argMax",
    "argMin",
    "percentile",
    "stddev",
    "variance",
]
ProtocolTimeGrain: TypeAlias = Literal["day", "week", "month", "quarter", "year"]
FrozenCanonicalValue: TypeAlias = (
    bool
    | str
    | int
    | float
    | tuple["FrozenCanonicalValue", ...]
    | Mapping[str, "FrozenCanonicalValue"]
    | None
)


def freeze_canonical_value(value: CanonicalValue) -> FrozenCanonicalValue:
    """Deep-freeze a detached canonical value without invoking user hooks."""

    if type(value) is list:
        return tuple(freeze_canonical_value(item) for item in cast(list[CanonicalValue], value))
    if type(value) is dict:
        source = cast(dict[str, CanonicalValue], value)
        return MappingProxyType({key: freeze_canonical_value(item) for key, item in source.items()})
    return cast(bool | str | int | float | None, value)


def thaw_canonical_value(value: FrozenCanonicalValue) -> CanonicalValue:
    """Return ordinary JSON containers for wire serialization."""

    if type(value) is tuple:
        return [thaw_canonical_value(item) for item in value]
    if isinstance(value, Mapping):
        return {key: thaw_canonical_value(item) for key, item in value.items()}
    return cast(bool | str | int | float | None, value)


@dataclass(frozen=True, slots=True)
class ProtocolReferenceExpression:
    name: ProtocolQualifiedIdentifier
    kind: Literal["reference"] = dataclass_field(init=False, default="reference")


@dataclass(frozen=True, slots=True)
class ProtocolLiteralExpression:
    value: FrozenCanonicalValue
    kind: Literal["literal"] = dataclass_field(init=False, default="literal")


@dataclass(frozen=True, slots=True)
class ProtocolBinaryExpression:
    operator: ProtocolBinaryOperator
    left: ProtocolExpression
    right: ProtocolExpression
    kind: Literal["binary"] = dataclass_field(init=False, default="binary")


@dataclass(frozen=True, slots=True)
class ProtocolCallExpression:
    function: ProtocolFunctionName
    args: tuple[ProtocolExpression, ...]
    kind: Literal["call"] = dataclass_field(init=False, default="call")


@dataclass(frozen=True, slots=True)
class ProtocolComparisonExpression:
    operator: ProtocolComparisonOperator
    left: ProtocolExpression
    right: ProtocolExpression
    kind: Literal["comparison"] = dataclass_field(init=False, default="comparison")


@dataclass(frozen=True, slots=True)
class ProtocolLogicalExpression:
    operator: Literal["and", "or", "not"]
    operands: tuple[ProtocolExpression, ...]
    kind: Literal["logical"] = dataclass_field(init=False, default="logical")


@dataclass(frozen=True, slots=True)
class ProtocolAggregateExpression:
    aggregation: ProtocolAggregation
    field: ProtocolQualifiedIdentifier
    arg_field: ProtocolQualifiedIdentifier | None = None
    level: int | float | None = None
    filters: tuple[ProtocolExpression, ...] | None = None
    kind: Literal["aggregate"] = dataclass_field(init=False, default="aggregate")


ProtocolExpression: TypeAlias = (
    ProtocolReferenceExpression
    | ProtocolLiteralExpression
    | ProtocolBinaryExpression
    | ProtocolCallExpression
    | ProtocolComparisonExpression
    | ProtocolLogicalExpression
    | ProtocolAggregateExpression
)


@dataclass(frozen=True, slots=True)
class ProtocolOrderBy:
    field: ProtocolQualifiedIdentifier
    direction: Literal["asc", "desc"]


@dataclass(frozen=True, slots=True)
class ProtocolDatasetQuery:
    dataset: ProtocolIdentifier
    dimensions: tuple[ProtocolQualifiedIdentifier, ...] | None = None
    measures: tuple[ProtocolIdentifier, ...] | None = None
    filters: tuple[ProtocolExpression, ...] | None = None
    order_by: tuple[ProtocolOrderBy, ...] | None = None
    limit: int | None = None
    offset: int | None = None
    by: ProtocolTimeGrain | None = None
    include_meta: bool | None = None
    kind: Literal["dataset"] = dataclass_field(init=False, default="dataset")


@dataclass(frozen=True, slots=True)
class ProtocolMetricQuery:
    dataset: ProtocolIdentifier
    metric: ProtocolIdentifier
    dimensions: tuple[ProtocolQualifiedIdentifier, ...] | None = None
    filters: tuple[ProtocolExpression, ...] | None = None
    order_by: tuple[ProtocolOrderBy, ...] | None = None
    limit: int | None = None
    offset: int | None = None
    by: ProtocolTimeGrain | None = None
    include_meta: bool | None = None
    kind: Literal["metric"] = dataclass_field(init=False, default="metric")


ProtocolSemanticQuery: TypeAlias = ProtocolDatasetQuery | ProtocolMetricQuery

_EXPRESSION_MAXIMUMS = {"max_depth": 16, "max_nodes": 1_000, "max_collection_items": 100}


@dataclass(frozen=True, slots=True)
class ProtocolExpressionLimits:
    """Product limits that may lower, but never raise, RFC 0003 limits."""

    max_depth: int = _EXPRESSION_MAXIMUMS["max_depth"]
    max_nodes: int = _EXPRESSION_MAXIMUMS["max_nodes"]
    max_collection_items: int = _EXPRESSION_MAXIMUMS["max_collection_items"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _EXPRESSION_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                raise ValueError(
                    f"{limit.name} must be a positive integer no greater than "
                    "the protocol v1 maximum"
                )


DEFAULT_PROTOCOL_EXPRESSION_LIMITS = ProtocolExpressionLimits()


def expression_to_data(expression: ProtocolExpression) -> dict[str, object]:
    """Serialize an immutable expression model into detached protocol data."""

    if isinstance(expression, ProtocolReferenceExpression):
        return {"kind": "reference", "name": expression.name}
    if isinstance(expression, ProtocolLiteralExpression):
        return {"kind": "literal", "value": thaw_canonical_value(expression.value)}
    if isinstance(expression, ProtocolBinaryExpression):
        return {
            "kind": "binary",
            "operator": expression.operator,
            "left": expression_to_data(expression.left),
            "right": expression_to_data(expression.right),
        }
    if isinstance(expression, ProtocolCallExpression):
        return {
            "kind": "call",
            "function": expression.function,
            "args": [expression_to_data(item) for item in expression.args],
        }
    if isinstance(expression, ProtocolComparisonExpression):
        return {
            "kind": "comparison",
            "operator": expression.operator,
            "left": expression_to_data(expression.left),
            "right": expression_to_data(expression.right),
        }
    if isinstance(expression, ProtocolLogicalExpression):
        key = "operand" if expression.operator == "not" else "operands"
        value: object = (
            expression_to_data(expression.operands[0])
            if expression.operator == "not"
            else [expression_to_data(item) for item in expression.operands]
        )
        return {"kind": "logical", "operator": expression.operator, key: value}
    result: dict[str, object] = {
        "kind": "aggregate",
        "aggregation": expression.aggregation,
        "field": expression.field,
    }
    if expression.arg_field is not None:
        result["argField"] = expression.arg_field
    if expression.level is not None:
        result["level"] = expression.level
    if expression.filters is not None:
        result["filters"] = [expression_to_data(item) for item in expression.filters]
    return result


def semantic_query_to_data(query: ProtocolSemanticQuery) -> dict[str, object]:
    """Serialize an immutable semantic query model into detached protocol data."""

    result: dict[str, object] = {"kind": query.kind, "dataset": query.dataset}
    if isinstance(query, ProtocolMetricQuery):
        result["metric"] = query.metric
    if query.dimensions is not None:
        result["dimensions"] = list(query.dimensions)
    if isinstance(query, ProtocolDatasetQuery) and query.measures is not None:
        result["measures"] = list(query.measures)
    if query.filters is not None:
        result["filters"] = [expression_to_data(item) for item in query.filters]
    if query.order_by is not None:
        result["orderBy"] = [
            {"field": item.field, "direction": item.direction} for item in query.order_by
        ]
    for key in ("limit", "offset", "by"):
        value = getattr(query, key)
        if value is not None:
            result[key] = value
    if query.include_meta is not None:
        result["includeMeta"] = query.include_meta
    return result
