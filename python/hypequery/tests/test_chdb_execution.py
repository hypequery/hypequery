"""Embedded chDB execution: the HTTP executor's boundary, on an in-process engine.

The fake-connection tests pin what reaches chDB. The rest run the real engine,
which CI installs with every extra: one in-memory database is shared by the
whole process, so each test works in a database of its own.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from importlib.util import find_spec
from typing import Any

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    ExecutionContext,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.planner import (
    CompiledQuery,
    CompiledQueryError,
    Deadline,
    TypedParameter,
    query_settings,
)
from hypequery.datasets.query_helpers import asc, in_list
from hypequery.execution import (
    AsyncChdbExecutor,
    ChdbExecutor,
    create_async_chdb_executor,
    create_chdb_executor,
)
from hypequery.execution.utils.json_compact import decode_json_compact
from hypequery.execution.utils.parameter_text import parameter_text
from hypequery.execution.utils.settings_clause import settings_clause, within_deadline
from test_import_hygiene import run_python


@dataclass
class Payload:
    data: bytes

    def bytes(self) -> bytes:
        return self.data


def json_compact(meta: list[tuple[str, str]], rows: list[list[object]]) -> Payload:
    document = {"meta": [{"name": n, "type": t} for n, t in meta], "data": rows}
    return Payload(json.dumps(document).encode())


class FakeConnection:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[tuple[str, str, dict[str, str] | None]] = []
        self.closed = False

    def query(self, sql: str, fmt: str = "CSV", *, params: dict[str, str] | None = None) -> object:
        self.calls.append((sql, fmt, params))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def close(self) -> None:
        self.closed = True


def compiled(value: object = "a'b", kind: str = "String", **policy: Any) -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
        **policy,
    )


def test_values_travel_as_parameters_and_limits_in_the_settings_clause() -> None:
    connection = FakeConnection(json_compact([("value", "String")], [["ok"]]))
    query = compiled("x' OR 1 = 1 --")
    rows = ChdbExecutor(connection).execute(query)
    assert rows.named_rows() == ({"value": "ok"},)
    sql, fmt, params = connection.calls[0]
    assert fmt == "JSONCompact"
    assert params == {"p0": "x\\' OR 1 = 1 --"}
    assert sql.startswith(query.sql + " SETTINGS ")
    assert "OR 1" not in sql
    assert sql.endswith(", readonly = 1")
    for name, value in query.settings.values.items():
        assert f"{name} = {value}" in sql


@pytest.mark.parametrize(
    ("value", "text"),
    [
        ("tab\there\nnew\\line'`", "tab\\\there\\\nnew\\\\line\\'\\`"),
        (None, "\\N"),
        (True, "true"),
        (2**64 - 1, "18446744073709551615"),
        (1.5e-7, "1.5e-07"),
        (Decimal("1E+3"), "1000"),
        (["a'b", None, "c"], "['a\\'b',NULL,'c']"),
        ([True, False], "[true,false]"),
        (datetime(2026, 10, 25, 1, 30, tzinfo=UTC), "1792891800.000000"),
        (datetime(2026, 10, 25, 1, 30), "2026-10-25 01:30:00.000000"),
        ([datetime(2026, 1, 1, tzinfo=UTC)], "['1767225600.000000']"),
    ],
)
def test_parameter_text(value: object, text: str) -> None:
    assert parameter_text(value) == text


def test_readonly_is_the_last_setting_applied() -> None:
    clause = settings_clause({"readonly": 1, "max_threads": 4}, {"fmt": "'iso'"})
    assert clause == " SETTINGS fmt = 'iso', max_threads = 4, readonly = 1"


@pytest.mark.parametrize(
    ("remaining", "expected"), [(None, 30), (100.0, 30), (2.2, 3), (0.1, 1), (-5.0, 1)]
)
def test_a_deadline_brings_the_engine_time_limit_forward(
    remaining: float | None, expected: int
) -> None:
    limits = within_deadline({"max_execution_time": 30, "readonly": 1}, remaining)
    assert limits == {"max_execution_time": expected, "readonly": 1}


def test_deadline_shortens_max_execution_time_on_the_wire() -> None:
    connection = FakeConnection(json_compact([("value", "String")], [["ok"]]))
    ChdbExecutor(connection).execute(compiled(deadline=Deadline.after(4.5)))
    assert "max_execution_time = 5," in connection.calls[0][0]


@pytest.mark.parametrize(
    "payload",
    [b"not json", b'{"meta": [], "data": [[1]]}', b'{"meta": [{"name": 1}], "data": []}', b"{}"],
)
def test_malformed_output_is_an_internal_error(payload: bytes) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        decode_json_compact(payload, "q")
    assert exc.value.category == "internal"


@pytest.mark.parametrize(
    ("message", "category"),
    [
        ("Code: 159. DB::Exception: Timeout exceeded. (TIMEOUT_EXCEEDED)", "deadline-exceeded"),
        (
            "Code: 396. DB::Exception: Limit for result exceeded. (TOO_MANY_ROWS_OR_BYTES)",
            "too-large",
        ),
        ("Code: 60. DB::Exception: Unknown table secret_t. (UNKNOWN_TABLE)", "internal"),
        ("Code: 81. DB::Exception: Database x does not exist. (UNKNOWN_DATABASE)", "unavailable"),
        ("no code at all", "internal"),
    ],
)
def test_engine_failures_map_without_echoing_engine_text(message: str, category: str) -> None:
    connection = FakeConnection(RuntimeError(message))
    with pytest.raises(CompiledQueryError) as exc:
        ChdbExecutor(connection).execute(compiled())
    assert exc.value.category == category
    assert "secret_t" not in str(exc.value)


@pytest.mark.parametrize(
    "query",
    [
        CompiledQuery("SELECT 1", {"p0": TypedParameter("p0", "String", "secret")}),
        CompiledQuery("DELETE FROM t", {}),
        compiled(deadline=Deadline.after(-1)),
    ],
)
def test_invalid_or_expired_query_never_reaches_chdb(query: CompiledQuery) -> None:
    connection = FakeConnection(json_compact([], []))
    with pytest.raises(CompiledQueryError):
        ChdbExecutor(connection).execute(query)
    assert connection.calls == []


def test_a_query_cancelled_while_running_reports_the_cancellation() -> None:
    cancellation = threading.Event()

    class Cancelling(FakeConnection):
        def query(self, *args: Any, **kwargs: Any) -> object:
            cancellation.set()
            return super().query(*args, **kwargs)

    connection = Cancelling(json_compact([("value", "String")], [["ok"]]))
    with pytest.raises(CompiledQueryError) as exc:
        ChdbExecutor(connection).execute(compiled(cancellation=cancellation))
    assert exc.value.category == "aborted"


def test_a_deadline_that_expires_while_queued_fails_without_starting() -> None:
    started = threading.Event()
    release = threading.Event()

    class Slow(FakeConnection):
        def query(self, *args: Any, **kwargs: Any) -> object:
            started.set()
            release.wait(5)
            return super().query(*args, **kwargs)

    connection = Slow(json_compact([("value", "String")], [["ok"]]))
    executor = ChdbExecutor(connection)
    first = threading.Thread(target=executor.execute, args=(compiled(),))
    first.start()
    started.wait(5)
    try:
        with pytest.raises(CompiledQueryError) as exc:
            executor.execute(compiled(deadline=Deadline.after(0.05)))
        assert exc.value.category == "deadline-exceeded"
    finally:
        release.set()
        first.join()
    assert len(connection.calls) == 1


def test_close_closes_the_connection() -> None:
    connection = FakeConnection(json_compact([], []))
    with ChdbExecutor(connection):
        pass
    assert connection.closed


def test_missing_extra_is_reported_actionably() -> None:
    result = run_python(
        """
        import sys

        sys.modules["chdb"] = None
        from hypequery.execution import create_chdb_executor

        try:
            create_chdb_executor()
        except ModuleNotFoundError as exc:
            assert 'Install "hypequery[chdb]"' in str(exc), exc
        else:
            raise AssertionError("expected ModuleNotFoundError")
        """
    )
    assert result.returncode == 0, result.stderr


# The real engine from here on: installed by the chdb extra on Linux and macOS.
needs_chdb = pytest.mark.skipif(find_spec("chdb") is None, reason="chdb is not installed")


def admin_query(sql: str) -> None:
    import chdb

    connection = chdb.connect(":memory:")
    try:
        connection.query(sql)
    finally:
        connection.close()


@pytest.fixture
def database(executor: ChdbExecutor) -> Iterator[str]:
    # The executor's open connection keeps the in-memory engine alive between
    # these short-lived admin connections.
    name = f"hq_chdb_{uuid.uuid4().hex[:12]}"
    admin_query(f"CREATE DATABASE {name}")
    yield name
    admin_query(f"DROP DATABASE IF EXISTS {name}")


@pytest.fixture
def executor() -> Iterator[ChdbExecutor]:
    with create_chdb_executor() as executor:
        yield executor


@needs_chdb
def test_a_dataset_query_runs_on_embedded_clickhouse(database: str, executor: ChdbExecutor) -> None:
    admin_query(
        f"CREATE TABLE {database}.orders (id String, country String, status String, "
        "amount Decimal(12, 2), created_at DateTime64(3, 'UTC')) ENGINE = Memory"
    )
    admin_query(
        f"INSERT INTO {database}.orders VALUES "  # noqa: S608 - generated name
        "('o1', 'NZ', 'paid', 10.50, '2026-01-01 00:00:00'), "
        "('o2', 'NZ', 'paid', 4.25, '2026-01-02 00:00:00'), "
        "('o3', 'AU', 'refunded', 99.00, '2026-01-03 00:00:00'), "
        "('o4', 'O''Brien\\tland', 'paid', 1.00, '2026-01-04 00:00:00')"
    )
    orders = Dataset(
        name="orders",
        source=f"{database}.orders",
        dimensions={"country": dimension.string(), "status": dimension.string()},
        measures={"revenue": measure.sum("amount"), "orders": measure.count("id")},
    )
    client = create_dataset_client(executor=executor)
    result = client.execute(
        orders,
        DatasetQuery(
            dimensions=("country",),
            measures=("revenue", "orders"),
            filters=(in_list("status", ["paid", "pending"]),),
            order_by=(asc("country"),),
        ),
        context=ExecutionContext(),
    )
    assert list(result.data) == [
        {"country": "NZ", "revenue": "14.75", "orders": 2},
        {"country": "O'Brien\tland", "revenue": "1.00", "orders": 1},
    ]


@needs_chdb
def test_results_decode_as_from_a_clickhouse_server(executor: ChdbExecutor) -> None:
    query = CompiledQuery(
        "SELECT toDecimal64(12.3, 3) AS d, toUInt64(18446744073709551615) AS u, "
        "toDateTime64('2024-01-01 09:00:00.5', 3, 'Asia/Tokyo') AS t, "
        "toDateTime('2024-01-01 00:00:00', 'UTC') AS t0, toDate('2024-01-02') AS day, "
        "toUUID('00000000-0000-0000-0000-00000000000a') AS id, nan AS n, toFloat64(2) AS f, "
        "toLowCardinality(toNullable('x')) AS lc, CAST(NULL AS Nullable(Int32)) AS null_int, "
        "true AS flag",
        {},
    )
    assert executor.execute(query).named_rows() == (
        {
            "d": "12.300",
            "u": 2**64 - 1,
            "t": "2024-01-01T00:00:00.500000+00:00",
            "t0": "2024-01-01T00:00:00+00:00",
            "day": "2024-01-02",
            "id": "00000000-0000-0000-0000-00000000000a",
            "n": None,
            "f": 2.0,
            "lc": "x",
            "null_int": None,
            "flag": True,
        },
    )


@needs_chdb
def test_an_array_result_is_refused_as_from_a_server(executor: ChdbExecutor) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        executor.execute(CompiledQuery("SELECT [1, 2] AS a", {}))
    assert exc.value.category == "internal"


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        ("".join(chr(i) for i in range(32)) + "\\N'`{p0:String}é", "String"),
        (["x'y", "z\\w", ""], "Array(String)"),
        (2**64 - 1, "UInt64"),
        (-(2**63), "Int64"),
        (Decimal("-123456789.012345678"), "Decimal(27,9)"),
        (True, "Bool"),
        (0.1, "Float64"),
    ],
)
def test_parameters_round_trip_through_the_engine(
    executor: ChdbExecutor, value: object, kind: str
) -> None:
    query = CompiledQuery(
        "SELECT {p0:" + kind + "} = {p0:" + kind + "} AS same, toString({p0:" + kind + "}) AS text",
        {"p0": TypedParameter("p0", kind, value)},
    )
    [row] = executor.execute(query).named_rows()
    assert row["same"] == 1
    expected = {
        "String": value,
        "Array(String)": "['x\\'y','z\\\\w','']",
        "Bool": "true",
    }.get(kind, str(value))
    assert row["text"] == expected


@needs_chdb
def test_an_instant_parameter_is_the_same_instant_in_any_time_zone(
    executor: ChdbExecutor,
) -> None:
    instant = datetime(2026, 3, 29, 1, 30, tzinfo=UTC)
    query = CompiledQuery(
        "SELECT toUnixTimestamp64Milli({p0:DateTime64(3)}) AS ms",
        {"p0": TypedParameter("p0", "DateTime64(3)", instant)},
    )
    assert executor.execute(query).named_rows() == ({"ms": int(instant.timestamp() * 1000)},)


@needs_chdb
def test_the_planner_limits_are_enforced(executor: ChdbExecutor) -> None:
    rows = CompiledQuery(
        "SELECT number FROM numbers(100)", {}, settings=query_settings(max_result_rows=10)
    )
    with pytest.raises(CompiledQueryError) as exc:
        executor.execute(rows)
    assert exc.value.category == "too-large"
    slow = CompiledQuery(
        "SELECT count() FROM numbers(100000000000)",
        {},
        settings=query_settings(max_execution_time=1),
    )
    with pytest.raises(CompiledQueryError) as exc:
        executor.execute(slow)
    assert exc.value.category == "deadline-exceeded"


@needs_chdb
def test_the_query_is_read_only(executor: ChdbExecutor) -> None:
    query = CompiledQuery("SELECT getSetting('readonly') AS level", {})
    assert executor.execute(query).named_rows() == ({"level": 1},)


@needs_chdb
def test_an_unknown_table_does_not_echo_engine_text(executor: ChdbExecutor) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        executor.execute(CompiledQuery("SELECT * FROM secret_table", {}))
    assert exc.value.category == "internal"
    assert "secret_table" not in str(exc.value)


@needs_chdb
def test_async_executor_runs_and_returns_at_once_on_cancellation() -> None:
    async def scenario() -> None:
        async with create_async_chdb_executor() as executor:
            assert isinstance(executor, AsyncChdbExecutor)
            ok = await executor.execute(CompiledQuery("SELECT 1 AS one", {}))
            assert ok.named_rows() == ({"one": 1},)
            cancellation = asyncio.Event()
            slow = CompiledQuery(
                "SELECT sleepEachRow(0.25) FROM numbers(4)", {}, cancellation=cancellation
            )
            task = asyncio.create_task(executor.execute(slow))
            await asyncio.sleep(0.1)
            started = time.monotonic()
            cancellation.set()
            with pytest.raises(CompiledQueryError) as exc:
                await task
            assert exc.value.category == "aborted"
            assert time.monotonic() - started < 0.5
            # The abandoned query holds the engine; the next one waits its turn.
            again = await executor.execute(CompiledQuery("SELECT 2 AS two", {}))
            assert again.named_rows() == ({"two": 2},)

    asyncio.run(scenario())


@needs_chdb
def test_async_executor_refuses_work_after_close() -> None:
    async def scenario() -> None:
        executor = create_async_chdb_executor()
        await executor.aclose()
        with pytest.raises(CompiledQueryError) as exc:
            await executor.execute(CompiledQuery("SELECT 1", {}))
        assert exc.value.category == "unavailable"

    asyncio.run(scenario())


@needs_chdb
def test_a_second_path_is_refused_actionably(tmp_path: object) -> None:
    # A fresh process: this one already holds the in-memory database.
    result = run_python(
        f"""
        from hypequery.execution import create_chdb_executor

        held = create_chdb_executor({str(tmp_path) + "/a"!r})
        try:
            create_chdb_executor({str(tmp_path) + "/b"!r})
        except RuntimeError as exc:
            assert "one chDB path at a time" in str(exc), exc
        else:
            raise AssertionError("expected RuntimeError")
        held.close()
        create_chdb_executor({str(tmp_path) + "/b"!r}).close()
        """
    )
    assert result.returncode == 0, result.stderr
