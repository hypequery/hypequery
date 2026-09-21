"""RFC 0006 node validators: the parts a deployment contract is built from."""

from __future__ import annotations

import math
from typing import cast

from .deployment_primitives import (
    AGGREGATIONS,
    FIELD_TYPES,
    GRAINS,
    OPERATORS,
    SEMANTIC_METADATA_FIELDS,
    ProtocolDeploymentLimits,
    array,
    bounded_text,
    exact_fields,
    identifier,
    optional_text,
    positive_integer,
    record,
    semantic_metadata,
    unique_strings,
)
from .errors import ProtocolExpressionError, deployment_error
from .expression_models import expression_to_data
from .expressions import validate_protocol_expression
from .sql_expressions import sql_expression_to_data, validate_protocol_sql_expression

_FORMULA_FUNCTIONS = frozenset(("nullIfZero", "coalesce", "round", "floor", "ceil"))
_FORMULA_OPERATORS = frozenset(("add", "subtract", "multiply", "divide"))


def expression_data(value: object, path: str) -> dict[str, object]:
    """Validate a portable expression and return it as contract data."""

    try:
        return expression_to_data(validate_protocol_expression(value))
    except ProtocolExpressionError:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)


def access(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    kind = node.get("kind")
    if kind == "public":
        exact_fields(node, ("kind",), (), path)
        return {"kind": "public"}
    if kind == "authenticated":
        exact_fields(node, ("kind", "roles", "scopes"), (), path)

        def claim(item: object, item_path: str) -> str:
            return bounded_text(item, item_path, limits.max_text_bytes)

        return {
            "kind": "authenticated",
            "roles": unique_strings(
                node["roles"], f"{path}.roles", limits.max_dataset_items, claim
            ),
            "scopes": unique_strings(
                node["scopes"], f"{path}.scopes", limits.max_dataset_items, claim
            ),
        }
    if type(kind) is not str:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.kind")
    deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")


def endpoint_tenant(
    value: object, path: str, limits: ProtocolDeploymentLimits
) -> dict[str, object]:
    node = record(value, path)
    kind = node.get("kind")
    if kind == "not-required":
        exact_fields(node, ("kind",), (), path)
        return {"kind": "not-required"}
    if kind in ("required", "optional"):
        exact_fields(node, ("kind", "mode"), ("column",), path)
        mode = node["mode"]
        if mode not in ("auto-inject", "manual"):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.mode")
        result: dict[str, object] = {"kind": kind, "mode": mode}
        if "column" in node:
            result["column"] = bounded_text(
                node["column"], f"{path}.column", limits.max_source_bytes
            )
        # Auto-injection has to know which column to constrain.
        if mode == "auto-inject" and "column" not in node:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.column")
        return result
    if type(kind) is not str:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.kind")
    deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")


def endpoint(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(node, ("access", "tenant"), ("cacheTtlMs", "maxLimit", "path"), path)
    result: dict[str, object] = {
        "access": access(node["access"], f"{path}.access", limits),
        "tenant": endpoint_tenant(node["tenant"], f"{path}.tenant", limits),
    }
    for key in ("cacheTtlMs", "maxLimit"):
        if key in node:
            result[key] = positive_integer(node[key], f"{path}.{key}")
    if "path" in node:
        endpoint_path = bounded_text(node["path"], f"{path}.path", limits.max_path_bytes)
        if not endpoint_path.startswith("/"):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.path")
        result["path"] = endpoint_path
    return result


def tenant(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    kind = node.get("kind")
    if kind == "not-required":
        exact_fields(node, ("kind",), (), path)
        return {"kind": "not-required"}
    if kind == "required":
        exact_fields(node, ("kind", "field"), (), path)
        return {
            "kind": "required",
            "field": bounded_text(node["field"], f"{path}.field", limits.max_source_bytes),
        }
    if type(kind) is not str:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.kind")
    deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")


def field_source(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    """A physical column, or a trusted-local SQL expression standing in for one.

    A malformed SQL envelope surfaces as a query-implementation failure rather
    than a deployment one: the envelope has its own stable codes, and the
    reference implementation lets them through unchanged.
    """

    node = record(value, path)
    if node.get("kind") == "column":
        exact_fields(node, ("kind", "column"), (), path)
        return {
            "kind": "column",
            "column": bounded_text(node["column"], f"{path}.column", limits.max_source_bytes),
        }
    return sql_expression_to_data(validate_protocol_sql_expression(node))


def dimension(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node,
        ("name", "type", "source", "filterable", "groupable"),
        ("label", "description", *SEMANTIC_METADATA_FIELDS),
        path,
    )
    if type(node["type"]) is not str or node["type"] not in FIELD_TYPES:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.type")
    for key in ("filterable", "groupable"):
        if type(node[key]) is not bool:
            deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.{key}")
    result: dict[str, object] = {
        "name": identifier(node["name"], f"{path}.name"),
        "type": node["type"],
        "source": field_source(node["source"], f"{path}.source", limits),
        "filterable": node["filterable"],
        "groupable": node["groupable"],
    }
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def measure(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node,
        ("name", "aggregation", "field", "filters"),
        ("argField", "level", "sql", "label", "description", *SEMANTIC_METADATA_FIELDS),
        path,
    )
    aggregation = node["aggregation"]
    if type(aggregation) is not str or aggregation not in AGGREGATIONS:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.aggregation")
    if (aggregation in ("argMax", "argMin")) != ("argField" in node):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.argField")
    if aggregation == "percentile":
        level = node.get("level")
        if type(level) is bool or type(level) not in (int, float):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.level")
        number = float(cast(int | float, level))
        if not math.isfinite(number) or not 0 <= number <= 1:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.level")
    elif "level" in node:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.level")

    result: dict[str, object] = {
        "name": identifier(node["name"], f"{path}.name"),
        "aggregation": aggregation,
        "field": identifier(node["field"], f"{path}.field", qualified=True),
        "filters": [
            expression_data(item, f"{path}.filters[{index}]")
            for index, item in enumerate(
                array(node["filters"], f"{path}.filters", limits.max_dataset_items)
            )
        ],
    }
    if "argField" in node:
        result["argField"] = identifier(node["argField"], f"{path}.argField", qualified=True)
    if "level" in node:
        result["level"] = node["level"]
    if "sql" in node:
        result["sql"] = sql_expression_to_data(validate_protocol_sql_expression(node["sql"]))
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def dataset_filter(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node,
        ("name", "field", "operators"),
        ("label", "description", *SEMANTIC_METADATA_FIELDS),
        path,
    )

    def operator(item: object, item_path: str) -> str:
        if type(item) is not str or item not in OPERATORS:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", item_path)
        return item

    operators = unique_strings(
        node["operators"], f"{path}.operators", limits.max_dataset_items, operator
    )
    if not operators:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.operators")
    result: dict[str, object] = {
        "name": identifier(node["name"], f"{path}.name"),
        "field": identifier(node["field"], f"{path}.field", qualified=True),
        "operators": operators,
    }
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def relationship(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    exact_fields(node, ("name", "kind", "target", "from", "to", "queryable"), (), path)
    kind = node["kind"]
    if kind not in ("belongsTo", "hasMany", "hasOne"):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")
    if type(node["queryable"]) is not bool:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.queryable")
    # `hasMany` is metadata only; joining it would fan out and corrupt aggregates.
    if (kind == "hasMany") == node["queryable"]:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.queryable")
    return {
        "name": identifier(node["name"], f"{path}.name"),
        "kind": kind,
        "target": identifier(node["target"], f"{path}.target"),
        "from": identifier(node["from"], f"{path}.from", qualified=True),
        "to": identifier(node["to"], f"{path}.to", qualified=True),
        "queryable": node["queryable"],
    }


def dataset_limits(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    keys = ("maxDimensions", "maxMeasures", "maxFilters", "maxResultSize")
    exact_fields(node, (), keys, path)
    return {key: positive_integer(node[key], f"{path}.{key}") for key in keys if key in node}


def freshness(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    exact_fields(node, ("maxAgeSeconds",), (), path)
    return {"maxAgeSeconds": positive_integer(node["maxAgeSeconds"], f"{path}.maxAgeSeconds")}


def defaults(value: object, path: str, limits: ProtocolDeploymentLimits) -> dict[str, object]:
    node = record(value, path)
    exact_fields(node, (), ("dimensions", "timeGrain"), path)
    result: dict[str, object] = {}
    if "dimensions" in node:
        result["dimensions"] = unique_strings(
            node["dimensions"],
            f"{path}.dimensions",
            limits.max_semantic_metadata_items,
            lambda item, item_path: identifier(item, item_path),
        )
    if "timeGrain" in node:
        grain = node["timeGrain"]
        if type(grain) is not str or grain not in GRAINS:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.timeGrain")
        result["timeGrain"] = grain
    if not result:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    return result


def formula_grammar(expression: object, path: str) -> None:
    """The subset of the expression grammar a derived formula may use.

    RFC 0003 is wider than anything a formula can be written in. A formula
    exists to be rebuilt and executed, so accepting a form nothing can rebuild
    would publish a contract that validates and then fails at the point of use.
    """

    node = expression if type(expression) is dict else {}
    kind = cast(dict[str, object], node).get("kind")
    values = cast(dict[str, object], node)

    def numeric_literal(child: object, child_path: str) -> None:
        candidate = child if type(child) is dict else {}
        entry = cast(dict[str, object], candidate)
        if entry.get("kind") != "literal" or type(entry.get("value")) not in (int, float):
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", child_path)

    if kind == "reference":
        return
    if kind == "binary":
        # Arithmetic only, and never over a bare value.
        if values.get("operator") not in _FORMULA_OPERATORS:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.operator")
        formula_grammar(values.get("left"), f"{path}.left")
        formula_grammar(values.get("right"), f"{path}.right")
        return
    if kind == "call":
        function = values.get("function")
        args = values.get("args")
        if function not in _FORMULA_FUNCTIONS:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.function")
        expected = 2 if function in ("round", "coalesce") else 1
        items = cast(list[object], args) if type(args) is list else []
        if len(items) != expected:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.args")
        formula_grammar(items[0], f"{path}.args[0]")
        if function == "round":
            numeric_literal(items[1], f"{path}.args[1]")
        elif function == "coalesce":
            fallback = items[1] if type(items[1]) is dict else {}
            # A `coalesce` fallback is the one position accepting a bare value.
            if cast(dict[str, object], fallback).get("kind") == "literal":
                numeric_literal(items[1], f"{path}.args[1]")
            else:
                formula_grammar(items[1], f"{path}.args[1]")
        return
    deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)


def formula_references(expression: object, names: set[str]) -> None:
    """Collect the aliases a validated formula names."""

    if type(expression) is not dict:
        return
    node = cast(dict[str, object], expression)
    kind = node.get("kind")
    if kind == "reference":
        name = node.get("name")
        if type(name) is str:
            names.add(name)
        return
    if kind == "binary":
        formula_references(node.get("left"), names)
        formula_references(node.get("right"), names)
        return
    if kind == "call":
        args = node.get("args")
        if type(args) is list:
            for argument in cast(list[object], args):
                formula_references(argument, names)
