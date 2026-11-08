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
from typing import Final

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

#: The largest ``max_result_bytes`` a stream may run under. A stream's memory
#: stays flat whatever its size, so rows and time bound it; this ceiling, far
#: above the 1 GiB a buffered result may reach, only stops a runaway.
STREAM_MAX_RESULT_BYTES: Final = 1 << 40


def setting_maximum(name: str, *, stream: bool = False) -> int:
    """The largest value *name* may take on the wire, for a page or a stream."""

    if stream and name == "max_result_bytes":
        return STREAM_MAX_RESULT_BYTES
    return SETTING_DEFINITIONS[name].maximum


def stream_query_settings(base: QuerySettings, max_result_bytes: int | None) -> QuerySettings:
    """*base* for a stream: the same limits, but ``max_result_bytes`` of its own.

    Only a trusted component calls this, with a value in
    [1, ``STREAM_MAX_RESULT_BYTES``]; a request context still tightens it.
    Without one, a stream keeps a ``max_result_bytes`` *base* set and takes
    ``STREAM_MAX_RESULT_BYTES`` in place of the default: a byte budget an
    operator chose is never loosened unasked.
    """

    if max_result_bytes is None:
        default = SETTING_DEFINITIONS["max_result_bytes"].default
        chosen = base["max_result_bytes"]
        max_result_bytes = STREAM_MAX_RESULT_BYTES if chosen == default else chosen
    if type(max_result_bytes) is not int or not 1 <= max_result_bytes <= STREAM_MAX_RESULT_BYTES:
        raise CompiledQueryError(
            "internal",
            f"stream max_result_bytes must be an integer in [1, {STREAM_MAX_RESULT_BYTES}]",
        )
    return QuerySettings(values={**base.values, "max_result_bytes": max_result_bytes})


def tighten_query_settings(base: QuerySettings, ceiling: QuerySettings | None) -> QuerySettings:
    """Intersect trusted policies; a request context cannot raise client limits."""
    if ceiling is None:
        return base
    return query_settings(**{name: min(base[name], ceiling[name]) for name in SETTING_DEFINITIONS})
