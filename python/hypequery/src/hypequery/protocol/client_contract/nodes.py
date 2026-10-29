"""Client descriptor validation; no database or serving dependency."""

from collections.abc import Callable
from typing import cast

from .errors import client_error
from .primitives import (
    FIELD_TYPES,
    GRAINS,
    OPERATORS,
    boolean,
    choice,
    integer,
    name,
    names,
    optional_shape,
    pointer,
    record,
    shape,
    text,
    timezone,
)


def dimension(value: object, path: str) -> dict[str, object]:
    node = shape(value, ["type", "wireType", "nullable", "groupable", "orderable"], path)
    kind = choice(node["type"], FIELD_TYPES, pointer(path, "type"))
    wires = (
        ["number", "string", "number-or-string"]
        if kind == "number"
        else (["boolean"] if kind == "boolean" else ["string"])
    )
    wire = choice(node["wireType"], wires, pointer(path, "wireType"))
    if type(node["nullable"]) is not bool and node["nullable"] != "unknown":
        client_error("HQ_CLIENT_SHAPE", pointer(path, "nullable"))
    return {
        "type": kind,
        "wireType": wire,
        "nullable": node["nullable"],
        "groupable": boolean(node["groupable"], pointer(path, "groupable")),
        "orderable": boolean(node["orderable"], pointer(path, "orderable")),
    }


def measure(value: object, path: str) -> dict[str, object]:
    node = shape(value, ["wireType", "nullable", "having"], path)
    if node["wireType"] != "string":
        client_error("HQ_CLIENT_SHAPE", pointer(path, "wireType"))
    if node["nullable"] is not True:
        client_error("HQ_CLIENT_SHAPE", pointer(path, "nullable"))
    return {
        "wireType": "string",
        "nullable": True,
        "having": boolean(node["having"], pointer(path, "having")),
    }


def filter_descriptor(value: object, path: str) -> dict[str, object]:
    node = shape(value, ["type", "operators"], path)
    kind = choice(node["type"], FIELD_TYPES, pointer(path, "type"))
    allowed = (
        ["eq", "neq", "in", "notIn", "isNull", "isNotNull"]
        if kind == "boolean"
        else ([item for item in OPERATORS if item != "like"] if kind == "number" else OPERATORS)
    )
    operators = names(node["operators"], pointer(path, "operators"), allowed)
    if not operators:
        client_error("HQ_CLIENT_SHAPE", pointer(path, "operators"))
    return {"type": kind, "operators": sorted(operators)}


def fields(
    value: object, path: str, validate: Callable[[object, str], object]
) -> dict[str, object]:
    node = record(value, path)
    if len(node) > 256:
        client_error("HQ_CLIENT_LIMIT", path)
    result: dict[str, object] = {}
    for key in sorted(node):
        name(key, path, qualified=True)
        result[key] = validate(node[key], pointer(path, key))
    return result


def time(value: object, path: str) -> dict[str, object] | None:
    if value is None:
        return None
    node = shape(value, ["grains", "defaultTimezone", "timezone", "periodFormat"], path)
    grains = names(node["grains"], pointer(path, "grains"), GRAINS)
    if not grains:
        client_error("HQ_CLIENT_SHAPE", pointer(path, "grains"))
    zone = timezone(node["defaultTimezone"], pointer(path, "defaultTimezone"))
    enabled = boolean(node["timezone"], pointer(path, "timezone"))
    if node["periodFormat"] != "calendar-date-or-local-datetime-v1":
        client_error("HQ_CLIENT_SHAPE", pointer(path, "periodFormat"))
    return {
        "grains": sorted(grains),
        "defaultTimezone": zone,
        "timezone": enabled,
        "periodFormat": node["periodFormat"],
    }


def limits(value: object, path: str) -> dict[str, object]:
    bounds = {
        "defaultLimit": (1, 100000),
        "maxLimit": (1, 100000),
        "maxOffset": (0, 1000000),
        "maxDimensions": (0, 100),
        "maxMeasures": (0, 100),
        "maxPredicates": (0, 100),
        "maxOrderBy": (0, 100),
        "maxFilterValues": (1, 10000),
    }
    node = shape(value, list(bounds), path)
    return {
        key: integer(node[key], low, high, pointer(path, key))
        for key, (low, high) in bounds.items()
    }


def _annotation(value: object, path: str, keys: list[str]) -> dict[str, object]:
    node = optional_shape(value, keys, path)
    result: dict[str, object] = {}
    if "label" in node:
        result["label"] = text(node["label"], pointer(path, "label"))
    if "description" in node:
        result["description"] = text(node["description"], pointer(path, "description"))
    return result


def annotations(value: object, path: str) -> dict[str, object]:
    """Presentation text; references to dimension/measure keys are checked with the endpoint's."""
    result = _annotation(value, path, ["label", "description", "fields"])
    node = cast(dict[str, object], value)
    if "fields" in node:
        fields_path = pointer(path, "fields")
        entries = record(node["fields"], fields_path)
        if len(entries) > 512:
            client_error("HQ_CLIENT_LIMIT", fields_path)
        if not entries:
            client_error("HQ_CLIENT_SHAPE", fields_path)
        described: dict[str, object] = {}
        for key in sorted(entries):
            name(key, fields_path, qualified=True)
            described[key] = _annotation(
                entries[key], pointer(fields_path, key), ["label", "description"]
            )
        result["fields"] = described
    return result
