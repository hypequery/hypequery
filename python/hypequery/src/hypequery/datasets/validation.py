"""Pure validation helpers for dataset definition models."""

from __future__ import annotations

from collections.abc import Mapping

from hypequery.protocol import (
    parse_protocol_identifier,
    parse_protocol_qualified_identifier,
)


def validate_identifier_map(values: Mapping[str, object]) -> None:
    """Validate logical names used as definition-map keys."""

    for name in values:
        parse_protocol_identifier(name)


def validate_identifier(value: str) -> str:
    """Validate and return a simple logical identifier."""

    return str(parse_protocol_identifier(value))


def validate_qualified_identifier(value: str) -> str:
    """Validate and return a qualified logical identifier."""

    return str(parse_protocol_qualified_identifier(value))


def validate_non_empty(value: str, *, field: str) -> str:
    """Reject blank physical names and trusted SQL strings."""

    if not value.strip():
        raise ValueError(f"{field} must not be empty")
    return value
