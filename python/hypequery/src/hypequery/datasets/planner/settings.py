"""The closed, typed settings allow-list.

RFC 0010 puts policy in settings and values in parameters, and keeps both out
of a caller's reach. A setting therefore has a name, a value type, and an
inclusive range fixed here; a product may tighten a range but never loosen it,
and a request may not set one at all. The planner's own defaults are the
conservative end: read-only, bounded time, bounded rows.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .errors import CompiledQueryError


@dataclass(frozen=True, slots=True)
class SettingDefinition:
    """One allowed setting: its inclusive range and the planner's default."""

    name: str
    minimum: int
    maximum: int
    default: int


#: Every setting a compiled query may carry. Nothing outside this mapping is
#: emitted, so an adapter reading a compiled query knows the whole surface.
SETTING_DEFINITIONS: Mapping[str, SettingDefinition] = {
    definition.name: definition
    for definition in (
        # ClickHouse's own read-only mode. 1 forbids writes and setting
        # changes; 2 would let the statement raise its own limits, which is
        # exactly what a ceiling is for, so 2 is outside the range.
        SettingDefinition("readonly", minimum=1, maximum=1, default=1),
        SettingDefinition("max_execution_time", minimum=1, maximum=3_600, default=30),
        SettingDefinition("max_result_rows", minimum=1, maximum=10_000_000, default=100_000),
        SettingDefinition("max_result_bytes", minimum=1, maximum=1 << 30, default=64 << 20),
        SettingDefinition("max_threads", minimum=1, maximum=64, default=4),
    )
}


@dataclass(frozen=True, slots=True)
class QuerySettings:
    """A validated settings map, applied per execution."""

    values: Mapping[str, int]

    def __getitem__(self, name: str) -> int:
        return self.values[name]

    @property
    def max_execution_time(self) -> int:
        return self.values["max_execution_time"]


def query_settings(**overrides: int) -> QuerySettings:
    """Build a settings map from the defaults, tightened by *overrides*.

    Only a trusted component calls this. An unknown name, a non-integer, or a
    value outside the declared range is refused rather than clamped: silently
    lowering a ceiling someone asked to raise would hide the policy error.
    """

    values = {name: definition.default for name, definition in SETTING_DEFINITIONS.items()}
    for name, value in overrides.items():
        definition = SETTING_DEFINITIONS.get(name)
        if definition is None:
            raise CompiledQueryError("internal", f"unknown query setting {name!r}")
        if type(value) is not int or not definition.minimum <= value <= definition.maximum:
            raise CompiledQueryError(
                "internal",
                f"setting {name!r} must be an integer in "
                f"[{definition.minimum}, {definition.maximum}]",
            )
        values[name] = value
    return QuerySettings(values=dict(values))


DEFAULT_QUERY_SETTINGS = query_settings()
