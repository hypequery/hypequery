"""The Python CLI's event contract and the local check every event must pass.

``contract.json`` is the single source of truth: the website's ingest proxy
validates against the same file, so an event that passes here is accepted there.
"""

from __future__ import annotations

import json
import re
from functools import cache
from importlib.resources import files
from typing import Any, Final, cast

COMMANDS: Final = (
    "init",
    "dev",
    "generate:datasets",
    "export:client-contract",
    "skill",
    "help",
    "version",
    "unknown",
)
EVENT_SCHEMA_VERSION: Final = 1
COMPLETED_EVENT: Final = "python_cli_command_completed"


@cache
def contract() -> dict[str, Any]:
    text = files(__package__).joinpath("contract.json").read_text(encoding="utf-8")
    return cast(dict[str, Any], json.loads(text))


def matches_format(name: str, value: object) -> bool:
    rule = contract()["VALUE_FORMATS"][name]
    flags = re.IGNORECASE if "i" in rule["pattern"]["flags"] else 0
    return (
        isinstance(value, str)
        and len(value) <= rule["maxLength"]
        and re.fullmatch(rule["pattern"]["source"], value, flags) is not None
    )


def enum_values(field: str) -> tuple[Any, ...]:
    return tuple(contract()["COMMON_PROPERTIES"][field]["values"])


def _field_valid(field: dict[str, Any], value: object) -> bool:
    kind = field["kind"]
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "enum":
        return not isinstance(value, bool) and value in field["values"]
    if kind == "enum_list":
        return (
            isinstance(value, list)
            and len(set(value)) == len(value)
            and all(item in field["values"] for item in value)
        )
    if kind == "format":
        return matches_format(field["format"], value)
    return False


def _fields_valid(fields: dict[str, Any], value: dict[str, Any]) -> bool:
    return all(
        key in fields and _field_valid(fields[key], item) for key, item in value.items()
    ) and all(field.get("optional") or key in value for key, field in fields.items())


def validate_event(event: str, properties: dict[str, Any]) -> bool:
    """Whether *properties* is exactly a valid payload; unknown keys are rejected."""

    definition = contract()["EVENT_CATALOG"].get(event)
    if definition is None:
        return False
    command = properties.get("command")
    variants = definition.get("variants", {})
    if not isinstance(command, str) or command not in variants:
        return False
    fields = {**contract()["COMMON_PROPERTIES"], **definition["properties"], **variants[command]}
    if not _fields_valid(fields, properties):
        return False
    allowed = {*contract()["COMMAND_FLAGS"][command], *contract()["GLOBAL_FLAGS"]}
    return all(flag in allowed for flag in properties["flags_used"])
