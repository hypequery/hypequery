"""Typed DataFrame conversions for dataset query results.

Each library is imported only when its conversion is called, so the datasets
package stays importable without any of them. Values are restored to Python
types once, from the result's column types, and each library then builds its
columns with an explicit dtype, so an empty result is typed the same way as a
full one.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime, tzinfo
from decimal import Decimal, InvalidOperation, localcontext
from functools import partial
from importlib import import_module
from types import ModuleType
from typing import TYPE_CHECKING, Any, Literal, TypeAlias, cast
from zoneinfo import ZoneInfo

from ..utils.output_column_types import ResultColumnType
from .results import ResultScalar

if TYPE_CHECKING:
    import pandas as pd
    import polars as pl
    import pyarrow as pa

    from .results import DatasetQueryResult

#: How decimal values convert: to ``float`` (the default, what most analysis
#: wants) or to exact ``decimal.Decimal`` values.
DecimalMode: TypeAlias = Literal["float", "decimal"]

#: A column's storage kind once its values are known.
_Kind: TypeAlias = Literal[
    "string", "integer", "unsigned", "float", "decimal", "boolean", "timestamp", "raw"
]

_EXTRAS = {"pandas": "pandas", "polars": "polars", "pyarrow": "arrow"}


def _require(module: str) -> ModuleType:
    try:
        return import_module(module)
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            f"converting a result needs {module}. "
            f'Install it with: pip install "hypequery[{_EXTRAS[module]}]"'
        ) from exc


def _timestamp(value: ResultScalar, zone: tzinfo) -> datetime:
    if type(value) is not str:
        raise ValueError("expected an ISO date or datetime string")
    parsed = datetime.fromisoformat(value)
    # Time buckets (``period``) and dates have no offset: they are wall-clock
    # values in the query's timezone. Instants arrive with one.
    return parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed.astimezone(zone)


def _integer(value: ResultScalar) -> int:
    if type(value) is int:
        return value
    if type(value) is str:
        return int(value)
    raise ValueError("expected an integer")


def _float(value: ResultScalar) -> float:
    if type(value) in (int, float, str):
        return float(value)  # type: ignore[arg-type]
    raise ValueError("expected a number")


def _decimal(value: ResultScalar) -> Decimal:
    if type(value) in (int, str):
        return Decimal(value)  # type: ignore[arg-type]
    if type(value) is float:
        # repr is the shortest string that round-trips, not the binary expansion.
        return Decimal(repr(value))
    raise ValueError("expected a number")


def _boolean(value: ResultScalar) -> bool:
    if type(value) is bool:
        return value
    if type(value) is int and value in (0, 1):
        # ClickHouse spells many flags UInt8.
        return bool(value)
    raise ValueError("expected a boolean")


_CONVERTERS: dict[_Kind, Callable[[ResultScalar], object]] = {
    "integer": _integer,
    "float": _float,
    "decimal": _decimal,
    "boolean": _boolean,
}


def _common_scale(values: list[object]) -> list[object]:
    """Decimals at one scale: a typed column has one, and some libraries refuse a mix.

    Rescaling is exact, so the context's precision is raised to fit the widest
    value; the default 28 digits would refuse a valid Decimal(38, s).
    """

    present = [value for value in values if isinstance(value, Decimal)]
    scale = max([0, *(-int(value.as_tuple().exponent) for value in present)])
    quantum = Decimal(1).scaleb(-scale)
    digits = max((value.adjusted() + 1 + scale for value in present if value), default=1)
    with localcontext() as context:
        context.prec = max(context.prec, digits)
        return [
            value.quantize(quantum) if isinstance(value, Decimal) else value for value in values
        ]


#: What every library's signed and unsigned 64-bit integer columns hold.
_INT64 = range(-(2**63), 2**63)
_UINT64 = range(2**64)


def _fits(values: list[object], bounds: range) -> bool:
    return all(value is None or value in bounds for value in values)


def _wide_integers(values: list[object]) -> tuple[_Kind, list[object]]:
    """The lossless column for integers beyond Int64, as ClickHouse's wider types produce."""

    if _fits(values, _UINT64):
        return "unsigned", values
    # Int128 and wider: exact decimals at scale 0.
    return "decimal", [None if value is None else Decimal(cast(int, value)) for value in values]


def _kind(
    declared: ResultColumnType, values: Sequence[ResultScalar], decimals: DecimalMode
) -> _Kind:
    if declared == "number":
        present = [value for value in values if value is not None]
        if present and all(type(value) is int for value in present):
            return "integer"
        return decimals
    if declared == "unknown":
        return "raw"
    return declared


def typed_columns(
    result: DatasetQueryResult, decimals: DecimalMode
) -> list[tuple[str, _Kind, list[object]]]:
    """Each column's name, storage kind, and values restored to Python types."""

    if decimals not in ("float", "decimal"):
        raise ValueError('decimals must be "float" or "decimal"')
    zone = ZoneInfo(result.timezone)
    unknown: tuple[ResultColumnType, ...] = ("unknown",)
    declared = result.column_types or unknown * len(result.columns)
    columns: list[tuple[str, _Kind, list[object]]] = []
    for name, column_type in zip(result.columns, declared, strict=True):
        values = [row[name] for row in result.data]
        kind = _kind(column_type, values, decimals)
        convert = partial(_timestamp, zone=zone) if kind == "timestamp" else _CONVERTERS.get(kind)
        if convert is None:
            columns.append((name, kind, list(values)))
            continue
        try:
            converted = [None if value is None else convert(value) for value in values]
        except (ValueError, InvalidOperation) as exc:
            raise ValueError(f"column {name!r} is declared {column_type}: {exc}") from None
        if kind == "decimal":
            converted = _common_scale(converted)
        elif kind == "integer" and not _fits(converted, _INT64):
            kind, converted = _wide_integers(converted)
        columns.append((name, kind, converted))
    return columns


def to_pandas(result: DatasetQueryResult, *, decimals: DecimalMode = "float") -> pd.DataFrame:
    pandas: Any = _require("pandas")
    dtypes: dict[_Kind, object] = {
        "timestamp": f"datetime64[us, {result.timezone}]",
        "integer": "Int64",
        "unsigned": "UInt64",
        "float": "float64",
        "decimal": "object",
        "boolean": "boolean",
    }
    series = {
        name: pandas.Series(values, dtype=dtypes.get(kind), name=name)
        for name, kind, values in typed_columns(result, decimals)
    }
    frame: pd.DataFrame = pandas.DataFrame(series, columns=list(result.columns))
    return frame


def to_polars(result: DatasetQueryResult, *, decimals: DecimalMode = "float") -> pl.DataFrame:
    polars: Any = _require("polars")
    dtypes: dict[_Kind, object] = {
        "timestamp": polars.Datetime("us", result.timezone),
        "integer": polars.Int64,
        "unsigned": polars.UInt64,
        "float": polars.Float64,
        "boolean": polars.Boolean,
        "string": polars.String,
    }
    frame: pl.DataFrame = polars.DataFrame(
        [
            polars.Series(name, values, dtype=dtypes.get(kind))
            for name, kind, values in typed_columns(result, decimals)
        ]
    )
    return frame


def to_arrow(result: DatasetQueryResult, *, decimals: DecimalMode = "float") -> pa.Table:
    pyarrow: Any = _require("pyarrow")
    dtypes: dict[_Kind, object] = {
        "timestamp": pyarrow.timestamp("us", tz=result.timezone),
        "integer": pyarrow.int64(),
        "unsigned": pyarrow.uint64(),
        "float": pyarrow.float64(),
        "boolean": pyarrow.bool_(),
        "string": pyarrow.string(),
    }
    columns = typed_columns(result, decimals)
    table: pa.Table = pyarrow.table(
        {name: pyarrow.array(values, type=dtypes.get(kind)) for name, kind, values in columns}
    )
    return table
