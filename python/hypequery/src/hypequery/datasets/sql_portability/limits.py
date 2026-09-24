"""Absolute SQL portability v1 limits, with support for stricter policy."""

from __future__ import annotations

from dataclasses import dataclass, fields

_MAXIMUMS = {
    "max_input_bytes": 65_536,
    "max_depth": 16,
    "max_nodes": 1_000,
}


@dataclass(frozen=True, slots=True)
class SqlPortabilityLimits:
    """Product limits that may lower, but never raise, the v1 limits."""

    max_input_bytes: int = _MAXIMUMS["max_input_bytes"]
    max_depth: int = _MAXIMUMS["max_depth"]
    max_nodes: int = _MAXIMUMS["max_nodes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the SQL portability v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_SQL_PORTABILITY_LIMITS = SqlPortabilityLimits()
