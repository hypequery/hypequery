"""Server parameters as the text ClickHouse parses for each typed placeholder.

The HTTP driver renders values itself; chDB passes each parameter through
``str()``, so a list would reach ClickHouse as ``[a,b]`` and fail to parse.
This renders the values ``bound_parameters`` admits the way ClickHouse reads a
query parameter: a top-level string in the escaped text format, an array
element as a quoted literal. The value is data, never SQL: the statement keeps
its ``{name:Type}`` placeholders.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import cast

from .datetime_parameters import unix_seconds

_BACKSLASH = "\\"
# The characters ClickHouse's escaped and quoted text formats read as syntax.
_ESCAPED = frozenset((_BACKSLASH, "'", "`", "\t", "\n"))


def _escape(value: str) -> str:
    return "".join(_BACKSLASH + char if char in _ESCAPED else char for char in value)


def _text(value: object, *, top_level: bool) -> str:
    if value is None:
        return "\\N" if top_level else "NULL"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is str:
        return _escape(value) if top_level else f"'{_escape(value)}'"
    if type(value) is Decimal:
        # Fixed point: ClickHouse refuses a Decimal written with an exponent.
        return format(value, "f")
    if type(value) is datetime:
        # An instant is exact Unix seconds; a wall-clock time is passed as written.
        instant = unix_seconds(value)
        text = instant if type(instant) is str else value.strftime("%Y-%m-%d %H:%M:%S.%f")
        return text if top_level else f"'{text}'"
    if type(value) in (list, tuple):
        items = cast(Sequence[object], value)
        return "[" + ",".join(_text(item, top_level=False) for item in items) + "]"
    # int and finite float: Python's repr is ClickHouse's numeric literal.
    return repr(value)


def parameter_text(value: object) -> str:
    """The text ClickHouse parses as the value of one query parameter."""

    return _text(value, top_level=True)
