"""Validate the server-parameter boundary before calling ClickHouse Connect."""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError

_NAME = re.compile(r"p(?:0|[1-9][0-9]*)\Z")
_TYPE = re.compile(
    r"(?:String|Float64|Bool|DateTime64\(3\)|Int64|UInt64|Decimal\([0-9]+,[0-9]+\))\Z"
)
_PLACEHOLDER = re.compile(r"\{(p(?:0|[1-9][0-9]*)):([^{}]+)\}")


def _valid_value(value: object) -> bool:
    if value is None or type(value) in (str, bool, int, Decimal, datetime):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) in (list, tuple):
        items = cast(Sequence[object], value)
        return all(_valid_value(item) and type(item) not in (list, tuple) for item in items)
    return False


def bound_parameters(compiled: CompiledQuery) -> dict[str, object]:
    """Reject malformed declarations so the driver cannot use client interpolation."""

    if compiled.operation != "query":
        raise CompiledQueryError("internal", "unsupported operation", query_id=compiled.query_id)
    if type(compiled.sql) is not str or not compiled.sql.lstrip().upper().startswith("SELECT "):
        raise CompiledQueryError("internal", "invalid compiled query", query_id=compiled.query_id)
    matches = _PLACEHOLDER.findall(compiled.sql)
    found = dict(matches)
    for name, kind in matches:
        if found[name] != kind:
            raise CompiledQueryError("internal", "invalid parameter", query_id=compiled.query_id)
    if set(found) != set(compiled.parameters):
        raise CompiledQueryError("internal", "invalid parameter", query_id=compiled.query_id)
    values: dict[str, object] = {}
    for name, parameter in compiled.parameters.items():
        kind = parameter.clickhouse_type
        scalar = kind[6:-1] if kind.startswith("Array(") and kind.endswith(")") else kind
        if (
            not _NAME.fullmatch(name)
            or parameter.name != name
            or not _TYPE.fullmatch(scalar)
            or found[name] != kind
            or not _valid_value(parameter.value)
        ):
            raise CompiledQueryError("internal", "invalid parameter", query_id=compiled.query_id)
        values[name] = parameter.value
    return values
