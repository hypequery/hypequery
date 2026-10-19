"""Timestamp parameters as instants ClickHouse cannot read as local time.

ClickHouse parses a `DateTime64` server parameter in the server's time zone and
rejects RFC 3339 text outright. Converting an instant to its own local wall
clock is ambiguous in the hour a daylight-saving change repeats, so an instant
travels as Unix seconds instead: one reading on every server. Text without an
offset is not an instant (RFC 0001) and is passed through as written.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECOND = timedelta(microseconds=1)


def _instant(value: object) -> datetime | None:
    if type(value) is datetime:
        return value if value.tzinfo is not None else None
    if type(value) is str:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else None
    return None


def unix_seconds(value: object) -> object:
    """An aware datetime or RFC 3339 instant as exact Unix seconds text."""

    instant = _instant(value)
    if instant is None:
        return value
    return str(Decimal((instant - _EPOCH) // _MICROSECOND).scaleb(-6))
