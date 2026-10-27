"""What a dataset client hands back, and the executor shape it accepts.

The executor is described structurally so this package never imports a driver:
`hypequery.execution`'s executors satisfy these protocols, and so does any test
double that returns columns and rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Protocol, TypeAlias

from ..planner import CompiledQuery, DatasetQuery
from ..utils.output_column_types import ResultColumnType

if TYPE_CHECKING:
    import pandas as pd
    import polars as pl
    import pyarrow as pa

    from .dataframes import DecimalMode

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
    """Rows keyed by column name, in the order the statement selected them.

    ``data`` keeps the JSON-safe scalars the driver boundary produces, so
    decimals, dates and datetimes are strings. ``column_types`` says what each
    column means, from the dataset definition; the ``to_*`` conversions use it
    to restore real dtypes. A result built without types converts every column
    as returned.
    """

    columns: tuple[str, ...]
    data: tuple[dict[str, ResultScalar], ...]
    meta: DatasetQueryMeta
    column_types: tuple[ResultColumnType, ...] = ()

    def to_pandas(self, *, decimals: DecimalMode = "float") -> pd.DataFrame:
        """A pandas DataFrame with typed columns. Requires ``hypequery[pandas]``.

        Timestamps become UTC ``datetime64``, counts nullable ``Int64``, other
        numbers ``float64`` (or ``Decimal`` objects with ``decimals="decimal"``;
        a number column of whole values only stays ``Int64``), booleans
        nullable ``boolean``.
        """

        from .dataframes import to_pandas

        return to_pandas(self, decimals=decimals)

    def to_polars(self, *, decimals: DecimalMode = "float") -> pl.DataFrame:
        """A polars DataFrame with typed columns. Requires ``hypequery[polars]``."""

        from .dataframes import to_polars

        return to_polars(self, decimals=decimals)

    def to_arrow(self, *, decimals: DecimalMode = "float") -> pa.Table:
        """A pyarrow Table with typed columns. Requires ``hypequery[arrow]``."""

        from .dataframes import to_arrow

        return to_arrow(self, decimals=decimals)


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
    column_types: tuple[ResultColumnType, ...] = (),
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
        column_types=column_types if len(column_types) == len(columns) else (),
    )
