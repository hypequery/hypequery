"""Portable shape of explicit ClickHouse FINAL source resolution."""

from __future__ import annotations

from .deployment_primitives import exact_fields, identifier, record
from .errors import deployment_error


def row_resolution(value: object, path: str) -> dict[str, object]:
    node = record(value, path)
    if "kind" not in node:
        deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.kind")
    if node.get("kind") != "final":
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.kind")
    # Without an engine: FINAL only, and no column can apply.
    if "engine" not in node:
        exact_fields(node, ("kind",), (), path)
        return {"kind": "final"}
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
