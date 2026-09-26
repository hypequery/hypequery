"""RFC 0015 deployment contract 3 node validators: segments and time measures.

Rules that need the rest of a dataset (the wrapped base measure, the time
field, and approximation) are checked by the dataset. Rules that need the query
grain (whole-bucket intervals, the bucket bound, and the time range) are
query-time checks, not contract rules.
"""

from __future__ import annotations

from typing import cast

from .deployment_nodes import expression_data
from .deployment_primitives import (
    GRAINS_V3,
    SEMANTIC_METADATA_FIELDS,
    ProtocolDeploymentLimits,
    exact_fields,
    identifier,
    optional_text,
    positive_integer,
    record,
    semantic_metadata,
)
from .errors import deployment_error

_WINDOW_FRAMES = ("trailing", "toDate", "cumulative")


def _is_segment_predicate(expression: dict[str, object]) -> bool:
    """A comparison between references and literals, or a logical tree of them."""

    kind = expression.get("kind")
    if kind == "comparison":
        return all(
            cast(dict[str, object], expression[side]).get("kind") in ("reference", "literal")
            for side in ("left", "right")
        )
    if kind != "logical":
        return False
    if expression.get("operator") == "not":
        return _is_segment_predicate(cast(dict[str, object], expression["operand"]))
    return all(
        _is_segment_predicate(cast(dict[str, object], item))
        for item in cast(list[object], expression["operands"])
    )


def _references(expression: object) -> list[str]:
    if type(expression) is list:
        return [name for item in expression for name in _references(item)]
    if type(expression) is not dict:
        return []
    node = cast(dict[str, object], expression)
    if node.get("kind") == "reference":
        return [cast(str, node["name"])]
    if node.get("kind") == "literal":
        return []
    return [name for key, item in node.items() if key != "kind" for name in _references(item)]


def _segment_reference_allowed(
    name: str, dimensions: list[dict[str, object]], tenant: dict[str, object]
) -> bool:
    """Only the dataset's own dimensions, and never the tenant field."""

    dimension = next((item for item in dimensions if item["name"] == name), None)
    if dimension is None:
        return False
    if tenant["kind"] != "required":
        return True
    source = cast(dict[str, object], dimension["source"])
    column = source.get("column") if source.get("kind") == "column" else None
    return tenant["field"] not in (dimension["name"], column)


def segment(
    value: object,
    path: str,
    limits: ProtocolDeploymentLimits,
    dimensions: list[dict[str, object]],
    tenant: dict[str, object],
) -> dict[str, object]:
    node = record(value, path)
    exact_fields(
        node, ("name", "predicate"), ("label", "description", *SEMANTIC_METADATA_FIELDS), path
    )
    name = identifier(node["name"], f"{path}.name")
    predicate = expression_data(node["predicate"], f"{path}.predicate", extension=2)
    if not _is_segment_predicate(predicate) or any(
        not _segment_reference_allowed(reference, dimensions, tenant)
        for reference in _references(predicate)
    ):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.predicate")
    result: dict[str, object] = {"name": name, "predicate": predicate}
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result


def _interval(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    exact_fields(node, ("amount", "unit"), (), path)
    amount = positive_integer(node["amount"], f"{path}.amount")
    unit = node["unit"]
    if type(unit) is not str or unit not in GRAINS_V3:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.unit")
    return {"amount": amount, "unit": unit}


def time_measure(
    node: dict[str, object], path: str, limits: ProtocolDeploymentLimits
) -> dict[str, object]:
    """Validate the shape of a contract 3 ``window`` or ``shift`` measure."""

    window = node.get("kind") == "window"
    exact_fields(
        node,
        ("kind", "name", "measure") if window else ("kind", "name", "measure", "interval"),
        (
            *(_WINDOW_FRAMES if window else ()),
            "approximate",
            "label",
            "description",
            *SEMANTIC_METADATA_FIELDS,
        ),
        path,
    )
    if "approximate" in node and node["approximate"] is not True:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.approximate")
    result: dict[str, object] = {
        "kind": node["kind"],
        "name": identifier(node["name"], f"{path}.name"),
        "measure": identifier(node["measure"], f"{path}.measure"),
    }
    if window:
        if sum(1 for key in _WINDOW_FRAMES if key in node) != 1:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
        if "trailing" in node:
            result["trailing"] = _interval(node["trailing"], f"{path}.trailing")
        if "toDate" in node:
            # A to-date period must be coarser than some bucket, so `minute` has none.
            to_date = node["toDate"]
            if type(to_date) is not str or to_date not in GRAINS_V3 or to_date == "minute":
                deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.toDate")
            result["toDate"] = to_date
        if "cumulative" in node:
            if node["cumulative"] is not True:
                deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.cumulative")
            result["cumulative"] = True
    else:
        result["interval"] = _interval(node["interval"], f"{path}.interval")
    if node.get("approximate") is True:
        result["approximate"] = True
    optional_text(node, "label", result, path, limits)
    optional_text(node, "description", result, path, limits)
    semantic_metadata(node, result, path, limits)
    return result
