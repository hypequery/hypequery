"""chDB's ``JSONCompact`` output as the typed rows the result codec expects.

``decode_result`` accepts the Python values clickhouse-connect yields. chDB
returns text, so each value is rebuilt from its column's ClickHouse type and
the same closed codec then decides what a caller may receive: a Decimal stays
exact, a timestamp is an aware UTC instant, and an Array, Map or Tuple is
refused exactly as it is from a ClickHouse server.

The output settings ``JSON_COMPACT_SETTINGS`` names are what make the text
exact: unquoted 64-bit integers, quoted Decimals with their scale, and ISO
timestamps in UTC whatever the process time zone.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import cast
from uuid import UUID

from hypequery.datasets.planner import CompiledQueryError

#: Output settings the decoder relies on; sent with every chDB query.
JSON_COMPACT_SETTINGS: Mapping[str, str] = {
    "output_format_json_quote_64bit_integers": "0",
    "output_format_json_quote_decimals": "1",
    "output_format_decimal_trailing_zeros": "1",
    "output_format_json_validate_utf8": "1",
    "date_time_output_format": "'iso'",
}

_WRAPPER = re.compile(r"(?:Nullable|LowCardinality)\((.*)\)\Z")
# ClickHouse prints up to nine fractional digits; Python 3.11 reads at most six.
_FRACTION = re.compile(r"(\.\d{6})\d+")


@dataclass(frozen=True, slots=True)
class JsonCompactResult:
    column_names: tuple[str, ...]
    result_rows: list[tuple[object, ...]]


def _base_type(kind: str) -> str:
    while (wrapped := _WRAPPER.match(kind)) is not None:
        kind = wrapped.group(1)
    return kind


def _value(kind: str, value: object) -> object:
    if value is None:
        return None
    if kind.startswith("Float"):
        # An integral float is written without a fraction; NaN and Inf as null.
        return float(cast(float, value)) if type(value) in (int, float) else value
    if type(value) is not str:
        return value
    text = value
    if kind.startswith("Decimal"):
        return Decimal(text)
    if kind.startswith("DateTime"):
        return datetime.fromisoformat(_FRACTION.sub(r"\1", text))
    if kind in ("Date", "Date32"):
        return date.fromisoformat(text)
    if kind == "UUID":
        return UUID(text)
    return text


def _columns(meta: object) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if type(meta) is not list:
        raise ValueError("meta")
    names: list[str] = []
    kinds: list[str] = []
    for column in cast(list[object], meta):
        if type(column) is not dict:
            raise ValueError("meta")
        fields = cast(dict[str, object], column)
        name, kind = fields.get("name"), fields.get("type")
        if type(name) is not str or type(kind) is not str:
            raise ValueError("meta")
        names.append(name)
        kinds.append(_base_type(kind))
    return tuple(names), tuple(kinds)


def decode_json_compact(payload: bytes, query_id: str) -> JsonCompactResult:
    """Parse one ``JSONCompact`` document; malformed output is an internal error."""

    try:
        document = json.loads(payload)
        names, kinds = _columns(document["meta"])
        data = document["data"]
        if type(data) is not list:
            raise ValueError("data")
        rows: list[tuple[object, ...]] = []
        for raw in cast(list[object], data):
            if type(raw) is not list or len(cast(list[object], raw)) != len(kinds):
                raise ValueError("row")
            values = cast(Sequence[object], raw)
            rows.append(tuple(_value(kind, item) for kind, item in zip(kinds, values, strict=True)))
    except (ValueError, KeyError, TypeError, InvalidOperation):
        raise CompiledQueryError("internal", "invalid result", query_id=query_id) from None
    return JsonCompactResult(names, rows)
