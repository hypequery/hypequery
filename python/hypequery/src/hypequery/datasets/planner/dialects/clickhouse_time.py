"""ClickHouse spellings for window and shift measure statements (RFC 0015).

Byte-compatible with TypeScript's `clickhouseDatasetSqlDialect` time and guard
primitives, so both languages plan the same statement shape. Every argument is
planner-built SQL: quoted identifiers, internal aliases, bound placeholders or
integers from validated definitions; guard messages are fixed constants.
"""

from __future__ import annotations

from typing import Final

from ...constants import GRAIN_FUNCTIONS
from ...measures import Measure
from ..errors import CompiledQueryError

_INTERVAL_UNITS: Final = {
    "minute": "Minutes",
    "hour": "Hours",
    "day": "Days",
    "week": "Weeks",
    "month": "Months",
    "quarter": "Quarters",
    "year": "Years",
}
_CLOCK_PARTS: Final = {"Hour", "Minute", "Second"}


def _string_literal(value: str) -> str:
    # ClickHouse treats backslash as an escape inside a string literal.
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


class ClickHouseTimeSql:
    """The time-measure primitives of the ClickHouse dialect."""

    __slots__ = ()

    def start_of(self, time: str, grain: str) -> str:
        return f"{GRAIN_FUNCTIONS[grain]}({time})"

    def start_of_in_zone(self, time: str, grain: str, timezone: str) -> str:
        # Calendar truncation returns a zone-less Date; keep it zoned.
        return f"toDateTime64({GRAIN_FUNCTIONS[grain]}({time}), 9, {timezone})"

    def add_time(self, time: str, amount: str | int, grain: str) -> str:
        return f"add{_INTERVAL_UNITS[grain]}({time}, {amount})"

    def subtract_time(self, time: str, amount: int, grain: str) -> str:
        return f"subtract{_INTERVAL_UNITS[grain]}({time}, {amount:d})"

    def time_diff(self, grain: str, start: str, end: str) -> str:
        if grain not in _INTERVAL_UNITS:
            raise CompiledQueryError("internal", f"Unsupported time grain {grain!r}.")
        return f"dateDiff('{grain}', {start}, {end})"

    def parse_timestamp(self, expression: str, timezone: str) -> str:
        return f"parseDateTime64BestEffort({expression}, 9, {timezone})"

    def timezone_of(self, time: str) -> str:
        return f"timezoneOf({time})"

    def clock_part(self, part: str, time: str) -> str:
        if part not in _CLOCK_PARTS:
            raise CompiledQueryError("internal", f"Unsupported clock part {part!r}.")
        return f"to{part}({time})"

    def is_date_only_type(self, expression: str) -> str:
        return (
            f"position(toTypeName({expression}), 'Date') > 0 AND "
            f"position(toTypeName({expression}), 'DateTime') = 0"
        )

    def guard(self, condition: str, message: str) -> str:
        return f"throwIf({condition}, {_string_literal(message)})"

    def if_else(self, condition: str, then: str, otherwise: str) -> str:
        return f"if({condition}, {then}, {otherwise})"

    def greatest(self, *expressions: str) -> str:
        return f"greatest({', '.join(expressions)})"

    def least(self, *expressions: str) -> str:
        return f"least({', '.join(expressions)})"

    def is_not_distinct_from(self, left: str, right: str) -> str:
        return f"isNotDistinctFrom({left}, {right})"

    def assume_not_null(self, expression: str) -> str:
        return f"assumeNotNull({expression})"

    def to_nullable(self, expression: str) -> str:
        return f"toNullable({expression})"

    def count_if(self, condition: str) -> str:
        return f"countIf({condition})"

    def series_index(self, count: str) -> str:
        return f"arrayJoin(range(toUInt64({count})))"

    def any_index(self, index: str, count: str, predicate: str) -> str:
        return f"arrayExists({index} -> {predicate}, range(toUInt64({count})))"

    def pack_row(self, expressions: list[str]) -> str:
        return f"tuple({', '.join(expressions)})"

    def row_element(self, row: str, position: int) -> str:
        return f"tupleElement({row}, {position:d})"

    def select_all_except(self, relation: str, columns: list[str]) -> str:
        return f"{relation}.* EXCEPT ({', '.join(columns)})"

    @property
    def asof_left_join(self) -> str:
        """Matches each left row to the nearest preceding right row."""

        return "LEFT ASOF JOIN"

    def filtered_input(self, condition: str, expression: str, fallback: str) -> str:
        return f"if({condition}, {expression}, {fallback})"

    def window_aggregate(self, measure: Measure, expression: str, arg: str) -> str:
        """The base measure re-aggregated over window rows; NULL, not 0, when empty."""

        aggregation = measure.aggregation
        if aggregation == "count":
            return f"count({expression})"
        if aggregation == "countDistinct":
            return f"uniqExact({expression})"
        if aggregation == "approxCountDistinct":
            return f"uniq({expression})"
        if aggregation == "merge":
            # -Merge takes no -OrNull; counts coalesce to 0 downstream.
            return f"{measure.state_function}Merge({expression})"
        if aggregation == "percentile":
            return f"quantileOrNull({measure.level!r})({expression})"
        if aggregation in ("argMax", "argMin"):
            return f"{aggregation}OrNull({expression}, {arg})"
        if aggregation == "stddev":
            return f"stddevSampOrNull({expression})"
        if aggregation == "variance":
            return f"varSampOrNull({expression})"
        return f"{aggregation}OrNull({expression})"

    def reaggregate(self, aggregation: str, expression: str) -> str:
        return f"{aggregation}OrNull({expression})"
