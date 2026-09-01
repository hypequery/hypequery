"""Strict RFC 0003 expression and semantic-query validation."""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal, TypeVar, cast

from .errors import ProtocolIdentifierError, ProtocolValueError, expression_error
from .expression_models import (
    DEFAULT_PROTOCOL_EXPRESSION_LIMITS,
    ProtocolAggregateExpression,
    ProtocolAggregation,
    ProtocolBinaryExpression,
    ProtocolBinaryOperator,
    ProtocolCallExpression,
    ProtocolComparisonExpression,
    ProtocolComparisonOperator,
    ProtocolDatasetQuery,
    ProtocolExpression,
    ProtocolExpressionLimits,
    ProtocolFunctionName,
    ProtocolLiteralExpression,
    ProtocolLogicalExpression,
    ProtocolMetricQuery,
    ProtocolOrderBy,
    ProtocolReferenceExpression,
    ProtocolSemanticQuery,
    ProtocolTimeGrain,
    freeze_canonical_value,
)
from .identifiers import (
    ProtocolIdentifier,
    ProtocolQualifiedIdentifier,
    parse_protocol_identifier,
    parse_protocol_qualified_identifier,
)
from .values import validate_canonical_value

_BINARY = frozenset(("add", "subtract", "multiply", "divide"))
_COMPARISONS = frozenset(("eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between", "like"))
_AGGREGATIONS = frozenset(
    (
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
    )
)
_GRAINS = frozenset(("day", "week", "month", "quarter", "year"))
_CALL_ARITY = {
    "nullIfZero": (1, 1),
    "coalesce": (2, 2),
    "round": (1, 2),
    "floor": (1, 1),
    "ceil": (1, 1),
}
_SAFE_INTEGER = 2**53 - 1


@dataclass(slots=True)
class _State:
    limits: ProtocolExpressionLimits
    active: set[int]
    nodes: int = 0


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        expression_error("HQ_EXPRESSION_TYPE", path)
    expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)


def _enter(value: dict[str, object], depth: int, state: _State, path: str) -> None:
    if depth > state.limits.max_depth:
        expression_error("HQ_EXPRESSION_TOO_DEEP", path)
    state.nodes += 1
    if state.nodes > state.limits.max_nodes:
        expression_error("HQ_EXPRESSION_TOO_MANY_NODES", path)
    identity = id(value)
    if identity in state.active:
        expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)
    state.active.add(identity)


@contextmanager
def _array_items(value: object, path: str, state: _State) -> Iterator[list[object]]:
    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            expression_error("HQ_EXPRESSION_TYPE", path)
        expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > state.limits.max_collection_items:
        expression_error("HQ_EXPRESSION_TOO_MANY_ITEMS", path)
    identity = id(items)
    if identity in state.active:
        expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)
    state.active.add(identity)
    try:
        yield items
    finally:
        state.active.remove(identity)


def _exact_fields(
    value: dict[str, object], required: tuple[str, ...], optional: tuple[str, ...], path: str
) -> None:
    allowed = frozenset((*required, *optional))
    for key in value:
        if type(key) is not str:
            expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)
        if key not in allowed:
            expression_error("HQ_EXPRESSION_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            expression_error("HQ_EXPRESSION_TYPE", f"{path}.{key}")


def _string(value: object, path: str) -> str:
    if type(value) is not str:
        expression_error("HQ_EXPRESSION_TYPE", path)
    return value


def _qualified_identifier(value: object, path: str) -> ProtocolQualifiedIdentifier:
    try:
        return parse_protocol_qualified_identifier(value)
    except ProtocolIdentifierError:
        expression_error("HQ_EXPRESSION_INVALID_IDENTIFIER", path)


def _simple_identifier(value: object, path: str) -> ProtocolIdentifier:
    try:
        return parse_protocol_identifier(value)
    except ProtocolIdentifierError:
        expression_error("HQ_EXPRESSION_INVALID_IDENTIFIER", path)


def _validate_expression(
    source: object, path: str, depth: int, state: _State
) -> ProtocolExpression:
    if type(source) is list and id(source) in state.active:
        expression_error("HQ_EXPRESSION_UNSAFE_OBJECT", path)
    value = _record(source, path)
    _enter(value, depth, state, path)
    try:
        kind = _string(value.get("kind"), f"{path}.kind")
        if kind == "reference":
            _exact_fields(value, ("kind", "name"), (), path)
            return ProtocolReferenceExpression(
                name=_qualified_identifier(value["name"], f"{path}.name")
            )
        if kind == "literal":
            _exact_fields(value, ("kind", "value"), (), path)
            try:
                literal = validate_canonical_value(value["value"])
            except ProtocolValueError:
                expression_error("HQ_EXPRESSION_INVALID_VALUE", f"{path}.value")
            return ProtocolLiteralExpression(value=freeze_canonical_value(literal))
        if kind == "binary":
            _exact_fields(value, ("kind", "operator", "left", "right"), (), path)
            operator = _string(value["operator"], f"{path}.operator")
            if operator not in _BINARY:
                expression_error("HQ_EXPRESSION_INVALID_OPERATOR", f"{path}.operator")
            return ProtocolBinaryExpression(
                operator=cast(ProtocolBinaryOperator, operator),
                left=_validate_expression(value["left"], f"{path}.left", depth + 1, state),
                right=_validate_expression(value["right"], f"{path}.right", depth + 1, state),
            )
        if kind == "call":
            _exact_fields(value, ("kind", "function", "args"), (), path)
            function = _string(value["function"], f"{path}.function")
            arity = _CALL_ARITY.get(function)
            if arity is None:
                expression_error("HQ_EXPRESSION_INVALID_OPERATOR", f"{path}.function")
            with _array_items(value["args"], f"{path}.args", state) as args:
                if not arity[0] <= len(args) <= arity[1]:
                    expression_error("HQ_EXPRESSION_INVALID_ARITY", f"{path}.args")
                validated = tuple(
                    _validate_expression(item, f"{path}.args[{index}]", depth + 1, state)
                    for index, item in enumerate(args)
                )
            return ProtocolCallExpression(
                function=cast(ProtocolFunctionName, function), args=validated
            )
        if kind == "comparison":
            _exact_fields(value, ("kind", "operator", "left", "right"), (), path)
            operator = _string(value["operator"], f"{path}.operator")
            if operator not in _COMPARISONS:
                expression_error("HQ_EXPRESSION_INVALID_OPERATOR", f"{path}.operator")
            left = _validate_expression(value["left"], f"{path}.left", depth + 1, state)
            right = _validate_expression(value["right"], f"{path}.right", depth + 1, state)
            _validate_comparison_operands(operator, right, f"{path}.right")
            return ProtocolComparisonExpression(
                operator=cast(ProtocolComparisonOperator, operator), left=left, right=right
            )
        if kind == "logical":
            return _validate_logical(value, path, depth, state)
        if kind == "aggregate":
            return _validate_aggregate(value, path, depth, state)
        expression_error("HQ_EXPRESSION_UNKNOWN_KIND", f"{path}.kind")
    finally:
        state.active.remove(id(value))


def _validate_logical(
    value: dict[str, object], path: str, depth: int, state: _State
) -> ProtocolLogicalExpression:
    _exact_fields(value, ("kind", "operator"), ("operand", "operands"), path)
    operator = _string(value["operator"], f"{path}.operator")
    if operator == "not":
        if "operand" not in value or "operands" in value:
            expression_error("HQ_EXPRESSION_INVALID_ARITY", path)
        operand = _validate_expression(value["operand"], f"{path}.operand", depth + 1, state)
        return ProtocolLogicalExpression(operator="not", operands=(operand,))
    if operator not in ("and", "or"):
        expression_error("HQ_EXPRESSION_INVALID_OPERATOR", f"{path}.operator")
    if "operands" not in value or "operand" in value:
        expression_error("HQ_EXPRESSION_INVALID_ARITY", path)
    with _array_items(value["operands"], f"{path}.operands", state) as operands:
        if len(operands) < 2:
            expression_error("HQ_EXPRESSION_INVALID_ARITY", f"{path}.operands")
        validated = tuple(
            _validate_expression(item, f"{path}.operands[{index}]", depth + 1, state)
            for index, item in enumerate(operands)
        )
    return ProtocolLogicalExpression(
        operator=cast(Literal["and", "or"], operator), operands=validated
    )


def _validate_comparison_operands(operator: str, right: ProtocolExpression, path: str) -> None:
    if operator == "like":
        if not isinstance(right, ProtocolLiteralExpression) or type(right.value) is not str:
            expression_error("HQ_EXPRESSION_INVALID_VALUE", path)
        return
    if operator not in ("in", "notIn", "between"):
        return
    if not isinstance(right, ProtocolLiteralExpression) or not isinstance(right.value, Mapping):
        expression_error("HQ_EXPRESSION_INVALID_VALUE", path)
    tag = right.value.get("$hypequery")
    if not isinstance(tag, Mapping):
        expression_error("HQ_EXPRESSION_INVALID_VALUE", path)
    expected_type = "tuple" if operator == "between" else "array"
    values = tag.get("values")
    if tag.get("type") != expected_type or type(values) is not tuple:
        expression_error("HQ_EXPRESSION_INVALID_VALUE", path)
    length = len(values)
    if length == 0 or (operator == "between" and length != 2):
        expression_error("HQ_EXPRESSION_INVALID_ARITY", path)


def _validate_aggregate(
    value: dict[str, object], path: str, depth: int, state: _State
) -> ProtocolAggregateExpression:
    _exact_fields(
        value,
        ("kind", "aggregation", "field"),
        ("argField", "level", "filters"),
        path,
    )
    aggregation = _string(value["aggregation"], f"{path}.aggregation")
    if aggregation not in _AGGREGATIONS:
        expression_error("HQ_EXPRESSION_INVALID_AGGREGATION", f"{path}.aggregation")
    is_arg = aggregation in ("argMax", "argMin")
    is_percentile = aggregation == "percentile"
    if is_arg != ("argField" in value) or is_percentile != ("level" in value):
        expression_error("HQ_EXPRESSION_INVALID_AGGREGATION", path)
    if is_arg and "filters" in value:
        expression_error("HQ_EXPRESSION_INVALID_AGGREGATION", f"{path}.filters")
    level: int | float | None = None
    if is_percentile:
        raw_level = value["level"]
        if type(raw_level) not in (int, float):
            expression_error("HQ_EXPRESSION_INVALID_AGGREGATION", f"{path}.level")
        level = cast(int | float, raw_level)
        if not math.isfinite(level) or not 0 <= level <= 1:
            expression_error("HQ_EXPRESSION_INVALID_AGGREGATION", f"{path}.level")
    filters: tuple[ProtocolExpression, ...] | None = None
    if "filters" in value:
        with _array_items(value["filters"], f"{path}.filters", state) as items:
            filters = tuple(
                _validate_predicate(
                    item,
                    f"{path}.filters[{index}]",
                    depth + 1,
                    state,
                    aggregate=True,
                )
                for index, item in enumerate(items)
            )
    return ProtocolAggregateExpression(
        aggregation=cast(ProtocolAggregation, aggregation),
        field=_qualified_identifier(value["field"], f"{path}.field"),
        arg_field=(
            _qualified_identifier(value["argField"], f"{path}.argField") if is_arg else None
        ),
        level=level,
        filters=filters,
    )


def _is_predicate(expression: ProtocolExpression) -> bool:
    if isinstance(expression, ProtocolComparisonExpression):
        return True
    return isinstance(expression, ProtocolLogicalExpression) and all(
        _is_predicate(item) for item in expression.operands
    )


def _validate_predicate(
    value: object,
    path: str,
    depth: int,
    state: _State,
    *,
    aggregate: bool,
) -> ProtocolExpression:
    expression = _validate_expression(value, path, depth, state)
    if not _is_predicate(expression):
        expression_error(
            "HQ_EXPRESSION_INVALID_AGGREGATION" if aggregate else "HQ_EXPRESSION_INVALID_QUERY",
            path,
        )
    return expression


def validate_protocol_expression(
    value: object,
    *,
    limits: ProtocolExpressionLimits = DEFAULT_PROTOCOL_EXPRESSION_LIMITS,
) -> ProtocolExpression:
    """Validate plain RFC 0003 data and return an immutable detached AST."""

    return _validate_expression(value, "$", 1, _State(limits=limits, active=set()))


def validate_protocol_semantic_query(
    source: object,
    *,
    limits: ProtocolExpressionLimits = DEFAULT_PROTOCOL_EXPRESSION_LIMITS,
) -> ProtocolSemanticQuery:
    """Validate a dataset or metric query and return an immutable snapshot."""

    state = _State(limits=limits, active=set())
    value = _record(source, "$")
    _enter(value, 1, state, "$")
    try:
        kind = _string(value.get("kind"), "$.kind")
        metric = kind == "metric"
        if not metric and kind != "dataset":
            expression_error("HQ_EXPRESSION_INVALID_QUERY", "$.kind")
        common = ("dimensions", "filters", "orderBy", "limit", "offset", "by", "includeMeta")
        _exact_fields(
            value,
            ("kind", "dataset", "metric") if metric else ("kind", "dataset"),
            common if metric else ("dimensions", "measures", *common[1:]),
            "$",
        )
        dataset = _simple_identifier(value["dataset"], "$.dataset")
        metric_name = _simple_identifier(value["metric"], "$.metric") if metric else None
        dimensions = _identifier_array(value, "dimensions", state, _qualified_identifier)
        measures = (
            None if metric else _identifier_array(value, "measures", state, _simple_identifier)
        )
        filters = _predicate_array(value, state)
        order_by = _order_array(value, state)
        limit = _query_integer(value, "limit")
        offset = _query_integer(value, "offset")
        grain: ProtocolTimeGrain | None = None
        if "by" in value:
            raw_grain = _string(value["by"], "$.by")
            if raw_grain not in _GRAINS:
                expression_error("HQ_EXPRESSION_INVALID_QUERY", "$.by")
            grain = cast(ProtocolTimeGrain, raw_grain)
        include_meta: bool | None = None
        if "includeMeta" in value:
            if type(value["includeMeta"]) is not bool:
                expression_error("HQ_EXPRESSION_INVALID_QUERY", "$.includeMeta")
            include_meta = value["includeMeta"]
        if metric:
            return ProtocolMetricQuery(
                dataset=dataset,
                metric=cast(ProtocolIdentifier, metric_name),
                dimensions=dimensions,
                filters=filters,
                order_by=order_by,
                limit=limit,
                offset=offset,
                by=grain,
                include_meta=include_meta,
            )
        return ProtocolDatasetQuery(
            dataset=dataset,
            dimensions=dimensions,
            measures=measures,
            filters=filters,
            order_by=order_by,
            limit=limit,
            offset=offset,
            by=grain,
            include_meta=include_meta,
        )
    finally:
        state.active.remove(id(value))


_Identifier = TypeVar("_Identifier", ProtocolIdentifier, ProtocolQualifiedIdentifier)


def _identifier_array(
    source: dict[str, object],
    key: str,
    state: _State,
    validator: Callable[[object, str], _Identifier],
) -> tuple[_Identifier, ...] | None:
    if key not in source:
        return None
    with _array_items(source[key], f"$.{key}", state) as items:
        return tuple(validator(item, f"$.{key}[{index}]") for index, item in enumerate(items))


def _predicate_array(
    source: dict[str, object], state: _State
) -> tuple[ProtocolExpression, ...] | None:
    if "filters" not in source:
        return None
    with _array_items(source["filters"], "$.filters", state) as items:
        return tuple(
            _validate_predicate(item, f"$.filters[{index}]", 1, state, aggregate=False)
            for index, item in enumerate(items)
        )


def _order_array(source: dict[str, object], state: _State) -> tuple[ProtocolOrderBy, ...] | None:
    if "orderBy" not in source:
        return None
    with _array_items(source["orderBy"], "$.orderBy", state) as items:
        result: list[ProtocolOrderBy] = []
        for index, item in enumerate(items):
            path = f"$.orderBy[{index}]"
            record = _record(item, path)
            _exact_fields(record, ("field", "direction"), (), path)
            direction = _string(record["direction"], f"{path}.direction")
            if direction not in ("asc", "desc"):
                expression_error("HQ_EXPRESSION_INVALID_QUERY", f"{path}.direction")
            result.append(
                ProtocolOrderBy(
                    field=_qualified_identifier(record["field"], f"{path}.field"),
                    direction=cast(Literal["asc", "desc"], direction),
                )
            )
        return tuple(result)


def _query_integer(source: dict[str, object], key: str) -> int | None:
    if key not in source:
        return None
    value = source[key]
    if type(value) is not int or value < 0 or value > _SAFE_INTEGER:
        expression_error("HQ_EXPRESSION_INVALID_QUERY", f"$.{key}")
    return value
