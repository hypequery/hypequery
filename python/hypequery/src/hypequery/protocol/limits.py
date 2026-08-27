"""Absolute RFC 0001 limits, with support for stricter product policy."""

from __future__ import annotations

from dataclasses import dataclass, fields

_MAXIMUMS = {
    "max_input_bytes": 1_048_576,
    "max_canonical_bytes": 1_048_576,
    "max_depth": 16,
    "max_nodes": 10_000,
    "max_collection_items": 1_000,
    "max_string_bytes": 65_536,
    "max_decoded_bytes": 65_536,
}


@dataclass(frozen=True, slots=True)
class CanonicalValueLimits:
    """Product limits that may lower, but never raise, RFC 0001 limits."""

    max_input_bytes: int = _MAXIMUMS["max_input_bytes"]
    max_canonical_bytes: int = _MAXIMUMS["max_canonical_bytes"]
    max_depth: int = _MAXIMUMS["max_depth"]
    max_nodes: int = _MAXIMUMS["max_nodes"]
    max_collection_items: int = _MAXIMUMS["max_collection_items"]
    max_string_bytes: int = _MAXIMUMS["max_string_bytes"]
    max_decoded_bytes: int = _MAXIMUMS["max_decoded_bytes"]

    def __post_init__(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            maximum = _MAXIMUMS[field.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{field.name} must be a positive integer no greater than "
                    "the protocol v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_CANONICAL_VALUE_LIMITS = CanonicalValueLimits()
