"""Validate named query zones and interpret local time-key bounds."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_NAME = re.compile(r"[A-Za-z][A-Za-z0-9._+-]*(?:/[A-Za-z0-9._+-]+)*\Z")


def validate_timezone(value: object) -> str:
    if type(value) is not str or len(value) > 100 or not _NAME.fullmatch(value):
        raise ValueError("Invalid timezone: use an IANA name such as UTC or America/New_York.")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(
            "Invalid timezone: use an IANA name such as UTC or America/New_York."
        ) from exc
    return value


def time_filter_value(value: object, timezone: str) -> object:
    """Preserve instants; interpret an offset-free timestamp in the query zone."""
    if type(value) is str:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return value
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=ZoneInfo(timezone)).isoformat()
    return value


def timezone_identity(identity: str, timezone: str | None) -> str:
    """Match TypeScript's partition for a deployed identity; UTC folds in nothing."""
    if timezone is None or timezone == "UTC":
        return identity
    validate_timezone(timezone)
    payload = "hypequery.ts.cache-timezone.v1\0" + identity + "\0" + timezone
    return hashlib.sha256(payload.encode()).hexdigest()
