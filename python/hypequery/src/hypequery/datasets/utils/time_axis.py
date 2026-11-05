"""The bounded output axis a window or shift query evaluates over (RFC 0015).

Pure helpers ported from TypeScript's `time-axis-bounds.ts`,
`time-axis-intervals.ts`, `shift-measure-grains.ts` and `time-measure-axis.ts`.
They validate grains and bounds and estimate the series in UTC; the SQL guards
enforce the exact, timezone-aware counts.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ..dataset import Dataset
from ..query_helpers import Filter
from ..time_measures import MeasureTimeInterval, ShiftMeasure, WindowMeasure
from .effective_filters import effective_filters

FIXED_MINUTES = {"minute": 1, "hour": 60, "day": 1440, "week": 10080}
CALENDAR_MONTHS = {"month": 1, "quarter": 3, "year": 12}
MAX_TO_DATE_BUCKETS: dict[str, dict[str, int]] = {
    "hour": {"minute": 60},
    "day": {"minute": 1440, "hour": 24},
    "week": {"minute": 10080, "hour": 168, "day": 7},
    "month": {"minute": 44640, "hour": 744, "day": 31},
    "quarter": {"minute": 132480, "hour": 2208, "day": 92, "month": 3},
    "year": {"minute": 527040, "hour": 8784, "day": 366, "month": 12, "quarter": 4},
}
MAX_ROW_CONTRIBUTIONS = 1000

_ISO_TIME_BOUND = re.compile(
    r"^(\d{4}-\d{2}-\d{2})"
    r"(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$"
)


@dataclass(frozen=True, slots=True)
class TimeBound:
    """An authored bound: its text for SQL, and an instant for estimates."""

    text: str
    #: The UTC instant for an offset bound; a wall-clock estimate for a local one.
    milliseconds: int
    nanoseconds: int
    sub_millisecond: bool
    has_offset: bool


@dataclass(frozen=True, slots=True)
class TimeAxis:
    grain: str
    lower: str
    upper: str
    lower_inclusive: bool
    upper_inclusive: bool
    #: The query's filters other than the time bounds the axis consumed.
    filters: tuple[Filter, ...]
    bucket_count: int
    result_limit: int | None


def parse_time_bound(value: object) -> TimeBound | None:
    """Parse without applying the process timezone, keeping nanosecond precision."""

    if type(value) is not str:
        return None
    match = _ISO_TIME_BOUND.match(value)
    if match is None:
        return None
    day, hour, minute, second, fraction, offset = match.groups()
    try:
        date = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        return None
    hours, minutes, seconds = int(hour or 0), int(minute or 0), int(second or 0)
    if hours > 23 or minutes > 59 or seconds > 59:
        return None
    digits = (fraction or "").ljust(9, "0")
    instant = date + timedelta(hours=hours, minutes=minutes, seconds=seconds)
    if offset is not None and offset != "Z":
        sign = 1 if offset[0] == "+" else -1
        instant -= sign * timedelta(hours=int(offset[1:3]), minutes=int(offset[4:6]))
    milliseconds = int(instant.timestamp()) * 1000 + int(digits[:3])
    remainder = int(digits[3:])
    return TimeBound(
        text=value,
        milliseconds=milliseconds,
        nanoseconds=milliseconds * 1_000_000 + remainder,
        sub_millisecond=remainder != 0,
        has_offset=offset is not None,
    )


def _time_column(dataset: Dataset, name: str) -> str:
    dimension = dataset.dimensions.get(name)
    return dimension.column or name if dimension is not None else name


@dataclass(frozen=True, slots=True)
class _Range:
    start: TimeBound
    end: TimeBound
    lower_inclusive: bool
    upper_inclusive: bool
    filters: tuple[Filter, ...]


def _time_range(dataset: Dataset, filters: Sequence[Filter]) -> _Range | None:
    """Exactly one bounded range on the time key; the remaining filters are kept."""

    declared = effective_filters(dataset)
    time_column = _time_column(dataset, dataset.time_key or "")

    def on_time_key(item: Filter) -> bool:
        definition = declared.get(item.field)
        field = definition.field if definition is not None else item.field
        return "." not in field and _time_column(dataset, field) == time_column

    time_filters = [item for item in filters if on_time_key(item)]
    lower: object = None
    upper: object = None
    lower_inclusive = upper_inclusive = True
    if len(time_filters) == 1 and time_filters[0].operator == "between":
        value = time_filters[0].value
        if isinstance(value, list | tuple) and len(value) == 2:
            lower, upper = value
    elif len(time_filters) == 2:
        start = next((f for f in time_filters if f.operator in ("gt", "gte")), None)
        end = next((f for f in time_filters if f.operator in ("lt", "lte")), None)
        lower = None if start is None else start.value
        upper = None if end is None else end.value
        lower_inclusive = start is not None and start.operator == "gte"
        upper_inclusive = end is not None and end.operator == "lte"
    start_bound, end_bound = parse_time_bound(lower), parse_time_bound(upper)
    if start_bound is None or end_bound is None:
        return None
    return _Range(
        start_bound,
        end_bound,
        lower_inclusive,
        upper_inclusive,
        tuple(item for item in filters if item not in time_filters),
    )


def _definitely_empty(range_: _Range) -> bool:
    """Mixed offset and local bounds cannot be ordered until the query zone is known."""

    if range_.start.has_offset != range_.end.has_offset:
        return False
    start, end = range_.start.nanoseconds, range_.end.nanoseconds
    return start > end or (start == end and not (range_.lower_inclusive and range_.upper_inclusive))


def interval_buckets(amount: int, unit: str, grain: str) -> int | None:
    """Exact conversions from RFC 0015; calendar months never become days."""

    both_fixed = unit in FIXED_MINUTES and grain in FIXED_MINUTES
    both_calendar = unit in CALENDAR_MONTHS and grain in CALENDAR_MONTHS
    if not (both_fixed or both_calendar):
        return None
    units = FIXED_MINUTES.get(unit) or CALENDAR_MONTHS[unit]
    buckets = FIXED_MINUTES.get(grain) or CALENDAR_MONTHS[grain]
    if (amount * units) % buckets:
        return None
    count = amount * units // buckets
    return count if 0 < count <= 2**53 - 1 else None


def calendar_shift_at_fine_grain(interval: MeasureTimeInterval, grain: str) -> bool:
    """Calendar shifts preserve dates; they do not turn months into fixed durations."""

    return interval.unit in ("month", "quarter", "year") and grain in (
        "minute",
        "hour",
        "day",
        "week",
    )


def supports_shift_grain(interval: MeasureTimeInterval, grain: str) -> bool:
    return (
        calendar_shift_at_fine_grain(interval, grain)
        or interval_buckets(interval.amount, interval.unit, grain) is not None
    )


def window_grain_error(name: str, window: WindowMeasure, grain: str) -> str | None:
    """The authored window's grain compatibility and maximum per-row contribution."""

    if window.trailing is not None:
        count = interval_buckets(window.trailing.amount, window.trailing.unit, grain)
    elif window.to_date is not None:
        count = MAX_TO_DATE_BUCKETS.get(window.to_date, {}).get(grain)
    else:
        count = 1
    if count is None:
        coarser = " at a strictly coarser grain" if window.to_date is not None else ""
        return f'Window measure "{name}" must span whole "{grain}" buckets{coarser}.'
    if count > MAX_ROW_CONTRIBUTIONS:
        return f'Window measure "{name}" would make a row contribute to more than 1,000 buckets.'
    return None


def _utc_bucket_start(milliseconds: int, grain: str) -> datetime:
    moment = datetime.fromtimestamp(milliseconds / 1000, UTC)
    if grain == "minute":
        return moment.replace(second=0, microsecond=0)
    if grain == "hour":
        return moment.replace(minute=0, second=0, microsecond=0)
    day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    if grain == "day":
        return day
    if grain == "week":
        # ClickHouse `toStartOfWeek` mode 0: weeks start on Sunday.
        return day - timedelta(days=(day.weekday() + 1) % 7)
    month = (
        1 if grain == "year" else (day.month - 1) // 3 * 3 + 1 if grain == "quarter" else day.month
    )
    return day.replace(month=month, day=1)


def _estimate_buckets(start: TimeBound, end: TimeBound, upper_inclusive: bool, grain: str) -> int:
    """A UTC estimate; SQL counts exact buckets in the query timezone."""

    first = _utc_bucket_start(start.milliseconds, grain)
    upper_bucket = _utc_bucket_start(end.milliseconds, grain)
    excludes_upper = (
        not upper_inclusive
        and not end.sub_millisecond
        and end.milliseconds == int(upper_bucket.timestamp() * 1000)
    )
    last = _utc_bucket_start(end.milliseconds - (1 if excludes_upper else 0), grain)
    months = CALENDAR_MONTHS.get(grain)
    if months is not None:
        span = (last.year - first.year) * 12 + last.month - first.month
        return span // months + 1
    minutes = FIXED_MINUTES[grain]
    return int((last - first).total_seconds()) // (minutes * 60) + 1


def _exceeds_estimated_limit(
    start: TimeBound, end: TimeBound, grain: str, buckets: int, limit: int | None
) -> bool:
    """Leave mixed bounds and local sub-day ranges to SQL's timezone-aware check."""

    if limit is None:
        return False
    estimable = start.has_offset == end.has_offset and (
        start.has_offset or grain not in ("minute", "hour")
    )
    # Two boundary buckets of slack: the query timezone is not known here.
    return limit == 0 or (estimable and buckets - 2 > limit)


def analyze_time_axis(
    dataset: Dataset,
    measures: Iterable[tuple[str, WindowMeasure | ShiftMeasure]],
    *,
    grain: str | None,
    filters: Sequence[Filter],
    result_limit: int | None,
) -> tuple[TimeAxis | None, list[str]]:
    """Validate grains and bounds for the selected time measures, then size the series."""

    selected = list(measures)
    subjects = (
        "Window and shift measures"
        if any(isinstance(definition, ShiftMeasure) for _, definition in selected)
        else "Window measures"
    )
    if grain is None or (grain not in FIXED_MINUTES and grain not in CALENDAR_MONTHS):
        return None, [f'{subjects} require a supported "by" grain.']
    errors: list[str] = []
    for name, definition in selected:
        if isinstance(definition, ShiftMeasure):
            if not supports_shift_grain(definition.interval, grain):
                errors.append(f'Shift measure "{name}" must span whole "{grain}" buckets.')
            continue
        error = window_grain_error(name, definition, grain)
        if error is not None:
            errors.append(error)
    found = _time_range(dataset, filters)
    if found is None:
        errors.append(
            f"{subjects} require exactly one bounded time range: between, or gt/gte with "
            "lt/lte, using ISO timestamps."
        )
        return None, errors
    if _definitely_empty(found):
        return None, [*errors, "Window measure time range must be non-empty and ordered."]
    buckets = _estimate_buckets(found.start, found.end, found.upper_inclusive, grain)
    if _exceeds_estimated_limit(found.start, found.end, grain, buckets, result_limit):
        errors.append(
            f"Window series exceeds the effective result limit of {result_limit} buckets."
        )
    return (
        TimeAxis(
            grain=grain,
            lower=found.start.text,
            upper=found.end.text,
            lower_inclusive=found.lower_inclusive,
            upper_inclusive=found.upper_inclusive,
            filters=found.filters,
            bucket_count=buckets,
            result_limit=result_limit,
        ),
        errors,
    )


__all__ = [
    "TimeAxis",
    "TimeBound",
    "analyze_time_axis",
    "calendar_shift_at_fine_grain",
    "interval_buckets",
    "parse_time_bound",
    "supports_shift_grain",
    "window_grain_error",
]
