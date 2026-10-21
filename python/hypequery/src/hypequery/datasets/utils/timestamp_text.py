"""Recognise the timestamp text a filter may bind, before ClickHouse coerces it.

ClickHouse reads an out-of-range or unparseable `DateTime64` parameter as some
other instant instead of refusing it, so validation accepts only calendar dates
and times in ISO 8601 extended form, which the executor binds exactly. A time
needs its seconds: ClickHouse refuses 2026-01-31 12:00.
"""

from __future__ import annotations

import re
from datetime import datetime

_TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)?"
    r"(?:Z|[+-]\d{2}:\d{2})?\Z"
)


def is_timestamp_text(value: str) -> bool:
    """True for a real date or date-time such as 2026-01-31 or 2026-01-31T12:00:00Z."""

    if not _TIMESTAMP.fullmatch(value):
        return False
    # fromisoformat stops at microseconds; the extra digits cannot make a
    # valid date invalid, so trim them before checking the calendar.
    trimmed = re.sub(r"(\.\d{6})\d+", r"\1", value)
    try:
        datetime.fromisoformat(trimmed)
    except ValueError:
        return False
    return True
