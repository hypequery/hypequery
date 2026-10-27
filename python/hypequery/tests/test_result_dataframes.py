"""Result column types and the typed DataFrame conversions built on them."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetQuery,
    DatasetQueryMeta,
    DatasetQueryResult,
    MemoryCacheStore,
    ResultCache,
    ResultColumnType,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar, dataframes
from hypequery.datasets.formulas import divide
from hypequery.datasets.utils.output_column_types import output_column_types
from hypequery.datasets.utils.output_columns import output_columns

CUSTOMERS = Dataset(
    name="customers",
    source="customers",
    dimensions={
        "id": dimension("string"),
        "country": dimension("string"),
        "signed_up": dimension("timestamp"),
    },
    measures={
        "first_signup": measure.min("signed_up"),
        "customers": measure.count_distinct("id"),
    },
)

ORDERS = Dataset(
    name="orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "status": dimension("string"),
        "amount": dimension("number"),
        "paid": dimension("boolean"),
        "created_at": dimension("timestamp"),
        "customer_id": dimension("string"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orders": measure.count("id"),
        "buyers": measure.count_distinct("customer_id"),
        "mean": measure.avg("amount"),
        "p90": measure.percentile("amount", 0.9),
        "first_order": measure.min("created_at"),
        "top_status": measure.max("status"),
        "latest_status": measure.arg_max("status", by="created_at"),
        "raw_min": measure.min("amount", sql="amount * 2"),
        "loose_min": measure.min("undeclared_column"),
        "per_order": measure.derived(divide("revenue", "orders")),
    },
    relationships={
        "customer": belongs_to(lambda: CUSTOMERS, from_field="customer_id", to_field="id")
    },
)

REGISTRY = create_dataset_registry(ORDERS, CUSTOMERS)


def test_types_follow_the_definition() -> None:
    query = DatasetQuery(
        by="month",
        dimensions=("status", "amount", "paid", "customer.country"),
        measures=(
            "revenue",
            "orders",
            "buyers",
            "mean",
            "p90",
            "first_order",
            "top_status",
            "latest_status",
            "raw_min",
            "loose_min",
            "per_order",
            "customer.first_signup",
            "customer.customers",
        ),
    )
    expected: tuple[ResultColumnType, ...] = (
        "timestamp",
        "string",
        "number",
        "boolean",
        "string",
        "number",
        "integer",
        "integer",
        "number",
        "number",
        "timestamp",
        "string",
        "string",
        "unknown",
        "unknown",
        "number",
        "timestamp",
        "integer",
    )
    types = output_column_types(ORDERS, query, REGISTRY)
    assert types == expected
    assert len(types) == len(output_columns(ORDERS, query))


def test_unresolvable_names_read_as_unknown() -> None:
    query = DatasetQuery(dimensions=("customer.country", "nowhere.x"), measures=("customer.nope",))
    assert output_column_types(ORDERS, query, None) == ("unknown", "unknown", "unknown")
    assert output_column_types(ORDERS, query, REGISTRY) == ("string", "unknown", "unknown")
    assert output_column_types(ORDERS, DatasetQuery(measures=("missing",)), REGISTRY) == (
        "unknown",
    )


@dataclass
class _Executor:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]
    calls: int = 0
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> _Executor:
        self.calls += 1
        self.seen.append(compiled)
        return self


def test_client_results_carry_types_from_cache_hits_too() -> None:
    executor = _Executor(("status", "orders"), (("paid", 3),))
    client = create_dataset_client(
        executor=executor,
        registry=REGISTRY,
        cache=ResultCache(store=MemoryCacheStore(), ttl_seconds=60),
    )
    query = DatasetQuery(dimensions=("status",), measures=("orders",))
    fresh = client.execute(ORDERS, query)
    cached = client.execute(ORDERS, query)
    assert (fresh.meta.cache, cached.meta.cache) == ("miss", "hit")
    assert fresh.column_types == cached.column_types == ("string", "integer")
    assert executor.calls == 1


def test_types_are_dropped_when_an_executor_returns_other_columns() -> None:
    client = create_dataset_client(executor=_Executor(("x",), ((1,),)), registry=REGISTRY)
    result = client.execute(ORDERS, DatasetQuery(dimensions=("status",), measures=("orders",)))
    assert result.column_types == ()


COLUMNS = ("period", "status", "revenue", "orders", "flag", "mean", "loose")
TYPES: tuple[ResultColumnType, ...] = (
    "timestamp",
    "string",
    "number",
    "integer",
    "boolean",
    "number",
    "unknown",
)
ROWS: tuple[tuple[ResultScalar, ...], ...] = (
    ("2026-01-01", "paid", "10.50", 3, True, 2.5, "x"),
    ("2026-02-01T00:00:00+00:00", None, None, None, 0, None, "y"),
    ("2026-03-01T05:30:00+05:30", "open", "0.1", 1, 1, 1, None),
)


def _result(
    rows: tuple[tuple[ResultScalar, ...], ...] = ROWS,
    types: tuple[ResultColumnType, ...] = TYPES,
    columns: tuple[str, ...] = COLUMNS,
    timezone: str = "UTC",
) -> DatasetQueryResult:
    return DatasetQueryResult(
        columns=columns,
        data=tuple(dict(zip(columns, row, strict=True)) for row in rows),
        meta=DatasetQueryMeta(query_id="q", row_count=len(rows), timing_ms=1.0),
        column_types=types,
        timezone=timezone,
    )


def test_typed_columns_restore_python_values() -> None:
    columns = {
        name: (kind, values) for name, kind, values in dataframes.typed_columns(_result(), "float")
    }
    assert columns["period"] == (
        "timestamp",
        [
            datetime(2026, 1, 1, tzinfo=UTC),
            datetime(2026, 2, 1, tzinfo=UTC),
            datetime(2026, 3, 1, tzinfo=UTC),
        ],
    )
    assert columns["revenue"] == ("float", [10.5, None, 0.1])
    assert columns["orders"] == ("integer", [3, None, 1])
    assert columns["flag"] == ("boolean", [True, False, True])
    assert columns["mean"] == ("float", [2.5, None, 1.0])
    assert columns["loose"] == ("raw", ["x", "y", None])
    typed = dataframes.typed_columns(_result(), "decimal")
    exact = {name: values for name, _, values in typed}
    assert exact["revenue"] == [Decimal("10.50"), None, Decimal("0.10")]
    assert [str(value) for value in exact["revenue"]] == ["10.50", "None", "0.10"]
    assert [str(value) for value in exact["mean"]] == ["2.5", "None", "1.0"]


def test_whole_number_columns_stay_integers() -> None:
    result = _result(((1,), (None,), (2,)), ("number",), ("n",))
    assert dataframes.typed_columns(result, "float") == [("n", "integer", [1, None, 2])]


def test_untyped_results_convert_as_returned() -> None:
    result = _result(types=())
    assert {kind for _, kind, _ in dataframes.typed_columns(result, "float")} == {"raw"}


@pytest.mark.parametrize(
    ("column_type", "value", "message"),
    [
        ("timestamp", "yesterday", "declared timestamp"),
        ("timestamp", 5, "ISO date"),
        ("integer", 1.5, "integer"),
        ("integer", "x", "declared integer"),
        ("number", True, "number"),
        ("number", "abc", "declared number"),
        ("boolean", 2, "boolean"),
    ],
)
def test_values_that_contradict_their_type_name_the_column(
    column_type: ResultColumnType, value: ResultScalar, message: str
) -> None:
    result = _result(((value,),), (column_type,), ("c",))
    with pytest.raises(ValueError, match=message) as caught:
        dataframes.typed_columns(result, "float" if column_type != "number" else "decimal")
    assert "'c'" in str(caught.value)


def test_decimal_mode_is_checked() -> None:
    with pytest.raises(ValueError, match="decimals"):
        _result().to_pandas(decimals="exact")  # type: ignore[arg-type]


def test_to_pandas() -> None:
    pd = pytest.importorskip("pandas")
    frame = _result().to_pandas()
    assert list(frame.columns) == list(COLUMNS)
    assert str(frame["period"].dtype) == "datetime64[us, UTC]"
    assert frame["period"].iloc[2] == pd.Timestamp("2026-03-01T00:00:00Z")
    assert str(frame["revenue"].dtype) == "float64"
    assert str(frame["orders"].dtype) == "Int64"
    assert str(frame["flag"].dtype) == "boolean"
    assert frame["orders"].isna().tolist() == [False, True, False]
    exact = _result().to_pandas(decimals="decimal")
    assert exact["revenue"].iloc[0] == Decimal("10.50")


def test_to_pandas_types_an_empty_result() -> None:
    pytest.importorskip("pandas")
    frame = _result(rows=()).to_pandas()
    assert frame.empty
    assert str(frame["period"].dtype) == "datetime64[us, UTC]"
    assert str(frame["orders"].dtype) == "Int64"


def test_to_polars() -> None:
    pl = pytest.importorskip("polars")
    frame = _result().to_polars()
    assert frame.columns == list(COLUMNS)
    assert frame.schema["period"] == pl.Datetime("us", "UTC")
    assert frame.schema["status"] == pl.String
    assert frame.schema["revenue"] == pl.Float64
    assert frame.schema["orders"] == pl.Int64
    assert frame.schema["flag"] == pl.Boolean
    assert isinstance(_result().to_polars(decimals="decimal").schema["revenue"], pl.Decimal)
    assert _result(rows=()).to_polars().schema["orders"] == pl.Int64


def test_to_arrow() -> None:
    pa = pytest.importorskip("pyarrow")
    table = _result().to_arrow()
    assert table.column_names == list(COLUMNS)
    assert table.schema.field("period").type == pa.timestamp("us", tz="UTC")
    assert table.schema.field("revenue").type == pa.float64()
    assert table.schema.field("orders").type == pa.int64()
    assert table.schema.field("flag").type == pa.bool_()
    assert pa.types.is_decimal(_result().to_arrow(decimals="decimal").schema.field("revenue").type)
    assert _result(rows=()).to_arrow().schema.field("orders").type == pa.int64()


@pytest.mark.parametrize(
    ("method", "module", "extra"),
    [
        ("to_pandas", "pandas", "pandas"),
        ("to_polars", "polars", "polars"),
        ("to_arrow", "pyarrow", "arrow"),
    ],
)
def test_a_missing_library_names_the_extra(
    monkeypatch: pytest.MonkeyPatch, method: str, module: str, extra: str
) -> None:
    def missing(name: str) -> Any:
        raise ModuleNotFoundError(f"No module named {name!r}", name=name)

    monkeypatch.setattr(dataframes, "import_module", missing)
    with pytest.raises(ModuleNotFoundError, match=rf"hypequery\[{extra}\]") as caught:
        getattr(_result(), method)()
    assert module in str(caught.value)


def test_exact_decimals_keep_values_wider_than_the_default_context() -> None:
    wide = "12345678901234567890123456789012345.01"
    result = _result(((wide,), ("0.1",)), ("number",), ("amount",))
    [(_, kind, values)] = dataframes.typed_columns(result, "decimal")
    assert kind == "decimal"
    assert [str(value) for value in values] == [wide, "0.10"]
    pa = pytest.importorskip("pyarrow")
    assert pa.types.is_decimal(result.to_arrow(decimals="decimal").schema.field("amount").type)


@pytest.mark.parametrize("declared", ["integer", "number"])
def test_integers_beyond_int64_convert_losslessly(declared: ResultColumnType) -> None:
    largest = 18446744073709551615
    result = _result(((largest,), (None,)), (declared,), ("n",))
    assert dataframes.typed_columns(result, "float") == [("n", "unsigned", [largest, None])]
    pytest.importorskip("pandas")
    assert result.to_pandas()["n"].iloc[0] == largest
    pytest.importorskip("polars")
    assert result.to_polars()["n"][0] == largest
    pytest.importorskip("pyarrow")
    assert result.to_arrow()["n"][0].as_py() == largest


def test_integers_beyond_uint64_become_exact_decimals() -> None:
    huge = -(2**100)
    result = _result(((huge,), (1,)), ("integer",), ("n",))
    assert dataframes.typed_columns(result, "float") == [
        ("n", "decimal", [Decimal(huge), Decimal(1)])
    ]
    pytest.importorskip("pyarrow")
    assert result.to_arrow()["n"][0].as_py() == Decimal(huge)


def test_timestamps_are_presented_in_the_query_timezone() -> None:
    from zoneinfo import ZoneInfo

    paris = ZoneInfo("Europe/Paris")
    result = _result(
        (("2026-01-01 00:00:00",), ("2026-02-01T00:00:00+00:00",), (None,)),
        ("timestamp",),
        ("period",),
        timezone="Europe/Paris",
    )
    [(_, _, values)] = dataframes.typed_columns(result, "float")
    # A bucket keeps its local midnight; an instant is converted, not relabelled.
    assert values == [
        datetime(2026, 1, 1, tzinfo=paris),
        datetime(2026, 2, 1, 1, tzinfo=paris),
        None,
    ]
    pd = pytest.importorskip("pandas")
    frame = result.to_pandas()
    assert str(frame["period"].dtype) == "datetime64[us, Europe/Paris]"
    assert frame["period"].iloc[0] == pd.Timestamp("2025-12-31T23:00:00Z")
    pl = pytest.importorskip("polars")
    assert result.to_polars().schema["period"] == pl.Datetime("us", "Europe/Paris")
    pa = pytest.importorskip("pyarrow")
    assert result.to_arrow().schema.field("period").type == pa.timestamp("us", tz="Europe/Paris")


def test_client_results_carry_the_query_timezone() -> None:
    client = create_dataset_client(
        executor=_Executor(("status",), (("paid",),)), registry=REGISTRY, timezone="Asia/Tokyo"
    )
    assert client.execute(ORDERS, DatasetQuery(dimensions=("status",), measures=())).timezone == (
        "Asia/Tokyo"
    )
    explicit = DatasetQuery(dimensions=("status",), measures=(), timezone="America/New_York")
    assert client.execute(ORDERS, explicit).timezone == "America/New_York"


def test_an_empty_driver_result_keeps_the_planned_columns_and_types() -> None:
    # clickhouse-connect returns no column names when no rows match.
    client = create_dataset_client(executor=_Executor((), ()), registry=REGISTRY)
    result = client.execute(ORDERS, DatasetQuery(dimensions=("status",), measures=("orders",)))
    assert (result.columns, result.column_types, result.data) == (
        ("status", "orders"),
        ("string", "integer"),
        (),
    )
    pytest.importorskip("pandas")
    frame = result.to_pandas()
    assert list(frame.columns) == ["status", "orders"]
    assert str(frame["orders"].dtype) == "Int64"
