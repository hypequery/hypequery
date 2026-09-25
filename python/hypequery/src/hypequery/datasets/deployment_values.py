"""Convert authored filter values and expressions into protocol data."""

from __future__ import annotations

from typing import cast

from hypequery.protocol import array_value, validate_canonical_value
from hypequery.protocol.values import CanonicalValue

from .immutability import FrozenMapping
from .query_helpers import Filter


def canonical_filter_value(value: object) -> CanonicalValue:
    """Preserve the tagged array/map distinction used by the TypeScript adapter."""

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
