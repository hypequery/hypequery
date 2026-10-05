"""What a dataset client hands back, and the executor shape it accepts.

The executor is described structurally so this package never imports a driver:
`hypequery.execution`'s executors satisfy these protocols, and so does any test
double that returns columns and rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, TypeAlias

from ..planner import CompiledQuery, DatasetQuery

#: A decoded cell. Matches the execution codec: decimals, UUIDs, dates, and
#: datetimes arrive as strings so no precision is lost on the way out.
ResultScalar = str | int | float | bool | None

#: What the result cache did for one call. `off`: no cache is configured.
#: `bypass`: a cache is configured, but this call could not or asked not to use
#: it. `hit` and `miss` mean what they say.
CacheStatus: TypeAlias = Literal["hit", "miss", "bypass", "off"]


class ResultRows(Protocol):
    """Column names in select order plus positional rows."""

    @property
    def columns(self) -> tuple[str, ...]: ...

    @property
    def rows(self) -> tuple[tuple[ResultScalar, ...], ...]: ...


class QueryExecutor(Protocol):
    """Runs a compiled query synchronously."""

    def execute(self, compiled: CompiledQuery) -> ResultRows: ...


class AsyncQueryExecutor(Protocol):
    """Runs a compiled query on the event loop."""

    async def execute(self, compiled: CompiledQuery) -> ResultRows: ...


@dataclass(frozen=True, slots=True)
class Pagination:
    limit: int
    offset: int
    has_more: bool


@dataclass(frozen=True, slots=True)
class DatasetQueryMeta:
    """Operational metadata that is safe to show any caller.

    SQL, parameters, and tenant scope are deliberately absent: RFC 0009 puts
    them behind a server-side permission, and a client result is not that.
    """

    query_id: str
    row_count: int
    timing_ms: float
    cache: CacheStatus = "off"
    pagination: Pagination | None = None


@dataclass(frozen=True, slots=True)
class DatasetQueryResult:
    """Rows keyed by column name, in the order the statement selected them."""

    columns: tuple[str, ...]
    data: tuple[dict[str, ResultScalar], ...]
    meta: DatasetQueryMeta


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Whether a query would plan, and why not when it would not."""

    valid: bool
    errors: tuple[str, ...] = ()


def build_result(
    rows: ResultRows,
    query_id: str,
    timing_ms: float,
    cache: CacheStatus = "off",
    *,
    query: DatasetQuery | None = None,
) -> DatasetQueryResult:
    """Key positional rows by column name.

    Every call gets fresh dicts, so a caller mutating its rows can never alter
    what a cache hands the next caller.
    """

    columns = tuple(rows.columns)
    pagination = None
    result_rows = rows.rows
    if query is not None and query.limit is not None:
        pagination = Pagination(query.limit, query.offset or 0, len(result_rows) > query.limit)
        result_rows = result_rows[: query.limit]
    data = tuple(dict(zip(columns, row, strict=True)) for row in result_rows)
    return DatasetQueryResult(
        columns=columns,
        data=data,
        meta=DatasetQueryMeta(
            query_id=query_id,
            row_count=len(data),
            timing_ms=timing_ms,
            cache=cache,
            pagination=pagination,
        ),
    )
