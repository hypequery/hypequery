"""Convert authored filter values and expressions into protocol data."""

from __future__ import annotations

from typing import cast

from hypequery.protocol import array_value, validate_canonical_value
from hypequery.protocol.values import CanonicalValue

from .immutability import FrozenMapping
from .query_helpers import Filter

#: Every integer of at most this magnitude is exactly representable in binary64.
MAX_EXACT_BINARY64_INTEGER = 2**53


def binary64_number(value: int) -> float:
    """A Python integer as the binary64 number a TypeScript author would write.

    RFC 0001 numbers are binary64, so `10` authored in Python must publish and
    hash exactly as `10` authored in TypeScript. An integer binary64 cannot hold
    exactly has no such spelling and is refused rather than rounded.
    """

    if abs(value) > MAX_EXACT_BINARY64_INTEGER:
        raise ValueError(
            "Integer filter values must be exactly representable as a binary64 number "
            "(magnitude at most 2**53)."
        )
    return float(value)


def canonical_filter_value(value: object) -> CanonicalValue:
    """Preserve the tagged array/map distinction used by the TypeScript adapter."""

    if type(value) is int:
        # `type() is`, not isinstance: a bool stays a boolean.
        return validate_canonical_value(binary64_number(value))
    if type(value) is tuple:
        items = cast(tuple[object, ...], value)
        return array_value([canonical_filter_value(item) for item in items])
    if isinstance(value, FrozenMapping):
        raise ValueError(
            "Object-valued measure filters are not portable between Python and TypeScript."
        )
    return validate_canonical_value(value)


def filter_expression(value: Filter) -> dict[str, object]:
    """A semantic filter is one RFC 0003 comparison expression."""

    return {
        "kind": "comparison",
        "operator": value.operator,
        "left": {"kind": "reference", "name": value.field},
        "right": {"kind": "literal", "value": canonical_filter_value(value.value)},
    }
