"""Portable shape of explicit ClickHouse FINAL source resolution."""

from __future__ import annotations

from .deployment_primitives import exact_fields, identifier, record
from .errors import deployment_error


def row_resolution(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    for key in ("kind", "engine"):
        if key not in node:
            deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.{key}")
    if node.get("kind") != "final":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")
    engine = node.get("engine")
    if engine not in ("replacing", "collapsing", "versioned-collapsing"):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.engine")
    column = "deletedColumn" if engine == "replacing" else "signColumn"
    exact_fields(node, ("kind", "engine"), (column,), path)
    result: dict[str, object] = {"kind": "final", "engine": engine}
    if column in node:
        result[column] = identifier(node[column], f"{path}.{column}")
    elif column == "signColumn":
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.signColumn")
    return result
