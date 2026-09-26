"""Closed result codec for ClickHouse's Python scalar values."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Protocol, cast
from uuid import UUID

from hypequery.datasets.planner import CompiledQueryError

JsonScalar = str | int | float | bool | None


class DriverResult(Protocol):
    @property
    def column_names(self) -> tuple[str, ...]: ...

    @property
    def result_rows(self) -> list[tuple[object, ...]]: ...


@dataclass(frozen=True, slots=True)
class QueryRows:
    columns: tuple[str, ...]
    rows: tuple[tuple[JsonScalar, ...], ...]

    def named_rows(self) -> tuple[dict[str, JsonScalar], ...]:
        return tuple(dict(zip(self.columns, row, strict=True)) for row in self.rows)


def _scalar(value: object, query_id: str) -> JsonScalar:
    if value is None or type(value) in (str, bool, int):
        return cast(JsonScalar, value)
    if type(value) is float and math.isfinite(value):
        return value
    if type(value) is Decimal and value.is_finite():
        return str(value)
    if type(value) is UUID:
        return str(value)
    if type(value) is date:
        return value.isoformat()
    if type(value) is datetime and value.tzinfo is not None:
        return value.astimezone(UTC).isoformat()
    raise CompiledQueryError("internal", "unsupported result type", query_id=query_id)


def decode_result(result: DriverResult, query_id: str) -> QueryRows:
    columns = tuple(result.column_names)
    if any(type(name) is not str for name in columns) or len(set(columns)) != len(columns):
        raise CompiledQueryError("internal", "invalid result columns", query_id=query_id)
    rows: list[tuple[JsonScalar, ...]] = []
    for raw in result.result_rows:
        if len(raw) != len(columns):
            raise CompiledQueryError("internal", "invalid result row", query_id=query_id)
        rows.append(tuple(_scalar(value, query_id) for value in raw))
    return QueryRows(columns, tuple(rows))
