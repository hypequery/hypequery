"""The relative date grammar of the ``inDateRange`` comparison (RFC 0029).

Values are lowercase ASCII words separated by single spaces. Parsing is exact:
no trimming, no case folding and no aliases, so every implementation accepts
the same strings. Mirrors ``packages/protocol/src/expressions/relative-dates.ts``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, TypeAlias, cast

ProtocolRelativeDateUnit: TypeAlias = Literal["day", "week", "month", "quarter", "year"]
ProtocolRelativeDateKind: TypeAlias = Literal["today", "yesterday", "this", "last", "toDate"]

_UNITS = "(day|week|month|quarter|year)"
_THIS = re.compile(rf"this {_UNITS}")
_LAST = re.compile(rf"last {_UNITS}")
_LAST_N = re.compile(rf"last ([1-9][0-9]{{0,3}}) {_UNITS}s?")
_TO_DATE = re.compile(r"(month|quarter|year) to date")


@dataclass(frozen=True, slots=True)
class ProtocolRelativeDateRange:
    """A parsed range; RFC 0029 section 2 gives the bounds each kind resolves to."""

    kind: ProtocolRelativeDateKind
    unit: ProtocolRelativeDateUnit | None = None
    #: ``last <unit>`` has count 1; ``last N <unit>(s)`` has count N.
    count: int | None = None


def parse_protocol_relative_date_range(value: object) -> ProtocolRelativeDateRange | None:
    """Return the parsed range, or ``None`` when ``value`` is not in the grammar."""

    if type(value) is not str:
        return None
    if value == "today":
        return ProtocolRelativeDateRange(kind="today")
    if value == "yesterday":
        return ProtocolRelativeDateRange(kind="yesterday")
    # fullmatch, never match: "$" in Python also matches before a trailing newline.
    if match := _THIS.fullmatch(value):
        return ProtocolRelativeDateRange(kind="this", unit=_unit(match[1]))
    if match := _LAST.fullmatch(value):
        return ProtocolRelativeDateRange(kind="last", unit=_unit(match[1]), count=1)
    if match := _LAST_N.fullmatch(value):
        return ProtocolRelativeDateRange(kind="last", unit=_unit(match[2]), count=int(match[1]))
    if match := _TO_DATE.fullmatch(value):
        return ProtocolRelativeDateRange(kind="toDate", unit=_unit(match[1]))
    return None


def _unit(value: str) -> ProtocolRelativeDateUnit:
    # The patterns only capture unit names.
    return cast(ProtocolRelativeDateUnit, value)


def is_protocol_relative_date_range(value: object) -> bool:
    """True when ``value`` is a relative date range of the RFC 0029 grammar."""

    return parse_protocol_relative_date_range(value) is not None
