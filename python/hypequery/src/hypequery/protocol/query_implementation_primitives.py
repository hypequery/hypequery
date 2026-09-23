"""Shared scalar and container rules for RFC 0005 query implementations.

The SQL-expression surface and the closed implementation union are two
validators over one error domain and one limit set, so the checks they share —
what counts as a record, an array, an exact field set, bounded trusted text —
live here rather than being written twice. A drift between the two would be a
protocol divergence with no fixture to catch it, because each surface has its
own cases.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Literal, cast

from .errors import ProtocolIdentifierError, query_implementation_error
from .identifiers import (
    ProtocolIdentifier,
    ProtocolQualifiedIdentifier,
    parse_protocol_identifier,
    parse_protocol_qualified_identifier,
)
from .js_strings import is_js_blank
from .utf8 import exceeds_utf8_byte_limit

_QUERY_IMPLEMENTATION_MAXIMUMS = {
    "max_statement_bytes": 1_048_576,
    "max_expression_bytes": 65_536,
    "max_type_bytes": 256,
    "max_source_bytes": 1_024,
    "max_collection_items": 100,
}


@dataclass(frozen=True, slots=True)
class ProtocolQueryImplementationLimits:
    """Product limits that may lower, but never raise, RFC 0005 limits."""

    max_statement_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_statement_bytes"]
    max_expression_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_expression_bytes"]
    max_type_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_type_bytes"]
    max_source_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_source_bytes"]
    max_collection_items: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_collection_items"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _QUERY_IMPLEMENTATION_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the protocol v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS = ProtocolQueryImplementationLimits()


def record(value: object, path: str) -> dict[str, object]:
    """Require a plain mapping, refusing anything that computes its contents."""

    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
    query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)


def array(value: object, path: str, max_items: int) -> list[object]:
    """Require a plain list within the collection bound."""

    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > max_items:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS", path)
    return items


def exact_fields(value: dict[str, object], required: tuple[str, ...], path: str) -> None:
    """Reject unknown keys, then absent required ones. Every field is required."""

    allowed = frozenset(required)
    for key in value:
        if type(key) is not str:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)
        if key not in allowed:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", f"{path}.{key}")


def identifier(value: object, path: str) -> ProtocolIdentifier:
    """Parse an RFC 0002 identifier into this surface's error domain."""

    try:
        return parse_protocol_identifier(value)
    except ProtocolIdentifierError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER", path)


def qualified_identifier(value: object, path: str) -> ProtocolQualifiedIdentifier:
    """Parse an RFC 0002 qualified identifier into this surface's error domain."""

    try:
        return parse_protocol_qualified_identifier(value)
    except ProtocolIdentifierError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER", path)


def bounded_text(
    value: object,
    path: str,
    max_bytes: int,
    *,
    allow_sql_whitespace: bool = False,
) -> str:
    """Require non-blank, control-free, bounded trusted text.

    `allow_sql_whitespace` admits tab, newline, and carriage return: the only
    control characters a formatted SQL fragment or statement legitimately
    contains. A ClickHouse type or a physical source name never carries one.
    """

    if type(value) is not str:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
    if is_js_blank(value):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    for character in value:
        code = ord(character)
        if (
            (code <= 0x1F and not (allow_sql_whitespace and code in (0x09, 0x0A, 0x0D)))
            or code == 0x7F
            or 0x80 <= code <= 0x9F
        ):
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    if len(value) > max_bytes or exceeds_utf8_byte_limit(value, max_bytes):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TOO_LARGE", path)
    return value


def dialect(value: object, path: str) -> Literal["clickhouse"]:
    """Require the one dialect version 1 defines."""

    if value != "clickhouse":
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    return "clickhouse"
