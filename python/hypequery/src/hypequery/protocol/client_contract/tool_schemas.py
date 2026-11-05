"""MCP query-tool JSON Schemas compiled from a client contract (RFC 0018).

Mirrors `buildClientContractQuerySchemas` in `@hypequery/datasets`. The shared
fixture `specs/mcp/tool-schemas-v1.json` pins both languages to the same
schemas. They are structural only: execution must still run
`validate_protocol_client_query(..., transport="mcp")`, which checks
selected-field dependencies, uniqueness and combined budgets.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TypedDict

from .models import ClientFilter, ProtocolClientContract, ProtocolClientEndpoint
from .validate import validate_protocol_client_contract

JsonSchema = dict[str, object]

#: Every `having` predicate compares a measure value as a number.
HAVING_OPERATORS = ("eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between")
_NULL_CHECKS = frozenset({"isNull", "isNotNull"})


class ClientContractToolSchemas(TypedDict):
    """The two fixed MCP query tools' input schemas for one contract."""

    contract: ProtocolClientContract
    query_dataset: JsonSchema
    query_metric: JsonSchema
    manifest_hash: str


def _never() -> JsonSchema:
    return {"not": {}}


def _union(schemas: Sequence[JsonSchema]) -> JsonSchema:
    if not schemas:
        return _never()
    if len(schemas) == 1:
        return schemas[0]
    return {"anyOf": list(schemas)}


def _enumeration(values: Iterable[str]) -> JsonSchema:
    items = list(values)
    return {"type": "string", "enum": items} if items else _never()


def _constant(value: str) -> JsonSchema:
    return {"type": "string", "const": value}


def _array(items: JsonSchema, *, maximum: int, minimum: int | None = None) -> JsonSchema:
    schema: JsonSchema = {} if minimum is None else {"minItems": minimum}
    schema.update({"maxItems": maximum, "type": "array", "items": items})
    return schema


def _object(properties: dict[str, JsonSchema], required: Sequence[str]) -> JsonSchema:
    schema: JsonSchema = {"type": "object", "properties": properties}
    if required:
        schema["required"] = list(required)
    schema["additionalProperties"] = False
    return schema


def _scalar(kind: str) -> JsonSchema:
    if kind == "number":
        return {"type": "number"}
    if kind == "boolean":
        return {"type": "boolean"}
    return {"type": "string"}


def _predicates(endpoint: ProtocolClientEndpoint, *, having: bool) -> JsonSchema:
    name = "measure" if having else "field"
    definitions: list[tuple[str, ClientFilter]] = (
        [
            (key, {"type": "number", "operators": list(HAVING_OPERATORS)})
            for key, measure in endpoint["measures"].items()
            if measure["having"]
        ]
        if having
        else list(endpoint["filters"].items())
    )
    clauses: list[JsonSchema] = []
    for key, definition in definitions:
        scalar = _scalar(definition["type"])
        for operator in definition["operators"]:
            properties: dict[str, JsonSchema] = {
                name: _constant(key),
                "operator": _constant(operator),
            }
            # A null check names no value (RFC 0023).
            if operator not in _NULL_CHECKS:
                properties["value"] = _predicate_value(endpoint, scalar, operator)
            clauses.append(_object(properties, list(properties)))
    return _union(clauses)


def _predicate_value(
    endpoint: ProtocolClientEndpoint, scalar: JsonSchema, operator: str
) -> JsonSchema:
    if operator == "between":
        return {
            "type": "array",
            "items": [scalar, scalar],
            "additionalItems": False,
            "minItems": 2,
            "maxItems": 2,
        }
    if operator in ("in", "notIn"):
        return _array(scalar, minimum=1, maximum=endpoint["limits"]["maxFilterValues"])
    return scalar


def _endpoint_schema(endpoint: ProtocolClientEndpoint) -> JsonSchema:
    limits = endpoint["limits"]
    dimensions = endpoint["dimensions"]
    groupable = [key for key, dimension in dimensions.items() if dimension["groupable"]]
    orderable = [
        *(key for key in groupable if dimensions[key]["orderable"]),
        *endpoint["measures"],
        *(["period"] if endpoint["time"] else []),
    ]
    order = _object(
        {
            "field": _enumeration(orderable),
            "direction": {"type": "string", "enum": ["asc", "desc"]},
        },
        ("field", "direction"),
    )
    properties: dict[str, JsonSchema] = {
        "dimensions": _array(_enumeration(groupable), maximum=limits["maxDimensions"]),
        "filters": _array(_predicates(endpoint, having=False), maximum=limits["maxPredicates"]),
        "orderBy": _array(order, maximum=limits["maxOrderBy"]),
        # HTTP clamps a larger limit; an agent sees the real ceiling instead.
        "limit": {"type": "integer", "minimum": 1, "maximum": limits["maxLimit"]},
        "offset": {"type": "integer", "minimum": 0, "maximum": limits["maxOffset"]},
        "includeMeta": (
            {"type": "boolean"} if endpoint["metadata"] else {"type": "boolean", "const": False}
        ),
    }
    if endpoint["kind"] == "dataset":
        properties["measures"] = _array(
            _enumeration(endpoint["measures"]), maximum=limits["maxMeasures"]
        )
        properties["having"] = _array(
            _predicates(endpoint, having=True), maximum=limits["maxPredicates"]
        )
    time = endpoint["time"]
    if time is not None:
        properties["grain"] = _enumeration(time["grains"])
        if time["timezone"]:
            properties["timezone"] = {"type": "string"}
    properties["dataset"] = _constant(endpoint["dataset"])
    required = ["dataset"]
    if endpoint["kind"] == "metric":
        properties["metric"] = _constant(endpoint["id"])
        required.append("metric")
    return _object(properties, required)


def _tool_schema(schemas: Sequence[JsonSchema], uncallable: Sequence[str]) -> JsonSchema:
    if not schemas:
        # Keep the fixed tool names while making an empty view uncallable.
        return _object({name: _never() for name in uncallable}, uncallable)
    schema = _union(schemas)
    return {**schema, "type": "object"} if "anyOf" in schema else schema


def build_client_contract_tool_schemas(value: object) -> ClientContractToolSchemas:
    """Compile the `query_dataset` and `query_metric` input schemas for a signed contract."""

    contract = validate_protocol_client_contract(value)
    datasets = [e for e in contract["endpoints"] if e["kind"] == "dataset"]
    metrics = [e for e in contract["endpoints"] if e["kind"] == "metric"]
    return {
        "contract": contract,
        "query_dataset": _tool_schema([_endpoint_schema(e) for e in datasets], ("dataset",)),
        "query_metric": _tool_schema([_endpoint_schema(e) for e in metrics], ("dataset", "metric")),
        "manifest_hash": contract["contentHash"],
    }
