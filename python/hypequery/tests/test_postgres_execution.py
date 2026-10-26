"""The Postgres dialect and executor, without a server."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from golden_model import ACME, REGISTRY, Events, Orders
from hypequery.datasets import DatasetQuery, create_dataset_client, plan_dataset_query
from hypequery.datasets import filter as f
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline
from hypequery.datasets.planner.dialects import POSTGRES
from hypequery.datasets.planner.settings import query_settings
from hypequery.execution import PostgresConnection, PostgresExecutor
from hypequery.execution.postgres import _arguments, _normalize, safe_postgres_error

psycopg = pytest.importorskip("psycopg")


def _compiled(**query: object) -> CompiledQuery:
    return plan_dataset_query(
        Orders,
        DatasetQuery.model_validate(query),
        registry=REGISTRY,
        context=ACME,
        dialect=POSTGRES,
    )


# Dialect


def test_identifiers_are_double_quoted_and_parameters_positional() -> None:
    compiled = _compiled(
        dimensions=("status",), measures=("orders",), filters=(f.eq("status", "x"),)
    )
    assert compiled.sql == (
        'SELECT "status" AS "status", COUNT("status") AS "orders" FROM "analytics"."orders" '
        'WHERE "status" = $1 AND "tenant_id" = $2 GROUP BY "status"'
    )
    assert compiled.dialect == "postgres"
    assert compiled.positional_parameter_values() == ["x", "acme"]
    assert compiled.to_sql().count("<p") == 2


def test_debug_form_does_not_rewrite_longer_placeholders() -> None:
    compiled = _compiled(
        measures=("orders",),
        filters=tuple(f.neq("status", str(index)) for index in range(11)),
    )
    debug = compiled.to_sql()
    assert "$" not in debug
    assert "<p10:text>" in debug
    assert "<p1:text>" in debug


def test_spellings_match_clickhouse_semantics() -> None:
    assert POSTGRES.quote('a"b') == '"a""b"'
    assert POSTGRES.membership("c", "$1", negated=True) == "NOT (c = ANY($1))"
    assert POSTGRES.divide("a", "b") == "(CAST(a AS double precision) / NULLIF(b, 0))"
    assert POSTGRES.order_term("x", descending=True) == "x DESC NULLS LAST"
    assert POSTGRES.group_key("upper(r)", '"r"') == "upper(r)"
    assert POSTGRES.distinct_count(["a", "b"]) == "COUNT(DISTINCT ROW(a, b))"
    assert POSTGRES.period_text("b", "week", "$1") == "to_char(b AT TIME ZONE $1, 'YYYY-MM-DD')"
    assert POSTGRES.scalar_type("UInt8") == "bigint"
    assert POSTGRES.array_type("text") == "text[]"
    with pytest.raises(CompiledQueryError):
        POSTGRES.truncate_to_grain("fortnight", "t", "$1")


def test_filtered_sums_are_zero_and_other_aggregates_null_over_no_rows() -> None:
    compiled = _compiled(measures=("paidRevenue", "paidP90"))
    assert 'COALESCE(SUM("net_amount") FILTER (WHERE' in compiled.sql
    assert 'percentile_cont(0.9) WITHIN GROUP (ORDER BY "net_amount") FILTER (WHERE' in compiled.sql


def test_time_filters_leave_the_column_bare() -> None:
    compiled = _compiled(
        measures=("orders",),
        timezone="America/New_York",
        filters=(f.gte("created_at", "2026-01-01"),),
    )
    assert '"created_at" >= (CASE WHEN pg_typeof((SELECT "created_at" FROM' in compiled.sql


def test_weeks_start_on_sunday_and_grains_truncate_in_the_zone() -> None:
    compiled = plan_dataset_query(
        Events,
        DatasetQuery.model_validate({"by": "week", "measures": ("events",)}),
        dialect=POSTGRES,
    )
    assert "date_trunc('week'" in compiled.sql
    assert "+ INTERVAL '1 day'" in compiled.sql
    hourly = plan_dataset_query(
        Events,
        DatasetQuery.model_validate({"by": "hour", "measures": ("events",)}),
        dialect=POSTGRES,
    )
    assert "date_trunc('hour', " in hourly.sql
    assert ", $1)" in hourly.sql


# Executor boundary


def test_the_executor_refuses_clickhouse_sql() -> None:
    clickhouse = plan_dataset_query(
        Orders,
        DatasetQuery.model_validate({"measures": ("orders",)}),
        registry=REGISTRY,
        context=ACME,
    )
    with pytest.raises(CompiledQueryError) as refused:
        _arguments(clickhouse)
    assert refused.value.category == "internal"


@pytest.mark.parametrize(
    "tamper",
    [
        lambda c: replace(c, sql=c.sql.replace("$2", "$3")),
        lambda c: replace(c, sql="DELETE FROM x"),
        lambda c: replace(c, parameters={}),
        lambda c: replace(c, settings=replace(c.settings, values={"readonly": 1})),
    ],
)
def test_the_executor_rechecks_the_compiled_query(tamper: Any) -> None:
    compiled = _compiled(measures=("orders",), filters=(f.eq("status", "x"),))
    with pytest.raises(CompiledQueryError):
        _arguments(tamper(compiled))


def test_the_statement_timeout_is_the_tighter_of_setting_and_deadline() -> None:
    compiled = _compiled(measures=("orders",))
    assert _arguments(compiled)[1] == 30_000
    assert _arguments(replace(compiled, settings=query_settings(max_execution_time=5)))[1] == 5_000
    assert _arguments(replace(compiled, deadline=Deadline.after(0.5)))[1] <= 500


def test_values_normalize_to_clickhouse_result_types() -> None:
    assert _normalize(Decimal("3500")) == 3500
    assert type(_normalize(Decimal("3500"))) is int
    assert _normalize(Decimal("1750.0000")) == 1750.0
    assert type(_normalize(Decimal("1750.0000"))) is float
    assert _normalize(Decimal("NaN")) is None
    assert _normalize(datetime(2026, 1, 1)) == datetime(2026, 1, 1, tzinfo=UTC)
    assert _normalize("x") == "x"


def test_driver_errors_map_to_safe_categories() -> None:
    errors = psycopg.errors
    cases = {
        errors.QueryCanceled(): "deadline-exceeded",
        errors.InvalidPassword(): "unauthenticated",
        errors.ReadOnlySqlTransaction(): "forbidden",
        errors.UndefinedTable(): "not-found",
        psycopg.OperationalError(): "unavailable",
        ValueError("secret detail"): "internal",
    }
    for error, category in cases.items():
        mapped = safe_postgres_error(error, "q1")
        assert mapped.category == category
        assert "secret" not in str(mapped)


def test_connection_reads_the_environment() -> None:
    assert PostgresConnection.from_env({"HYPEQUERY_POSTGRES_URL": "postgresql://a"}).conninfo
    assert (
        PostgresConnection.from_env({"DATABASE_URL": "postgresql://b"}).conninfo == "postgresql://b"
    )
    assert "postgresql" not in repr(PostgresConnection("postgresql://user:pw@h/db"))
    with pytest.raises(ValueError, match="HYPEQUERY_POSTGRES_URL"):
        PostgresConnection.from_env({})


@dataclass
class _FakeCursor:
    rows: list[tuple[object, ...]]
    executed: list[tuple[str, list[object]]] = field(default_factory=list)
    description: list[Any] = field(default_factory=list)

    def execute(self, sql: str, values: list[object]) -> None:
        self.executed.append((sql, values))

    def fetchmany(self, size: int) -> list[tuple[object, ...]]:
        return self.rows[:size]


@dataclass
class _Column:
    name: str


@dataclass
class _FakeConnection:
    statements: list[str] = field(default_factory=list)
    rolled_back: bool = False

    def execute(self, sql: str) -> None:
        self.statements.append(sql)

    @contextmanager
    def transaction(self, *, force_rollback: bool = False) -> Iterator[None]:
        yield
        self.rolled_back = force_rollback

    def cancel_safe(self, timeout: float) -> None:
        pass


def _executor(
    rows: list[tuple[object, ...]], columns: tuple[str, ...]
) -> tuple[PostgresExecutor, _FakeConnection, _FakeCursor]:
    connection = _FakeConnection()
    cursor = _FakeCursor(rows, description=[_Column(name) for name in columns])

    @contextmanager
    def connect() -> Iterator[Any]:
        yield connection

    return PostgresExecutor(connect, cursor=lambda _: cursor), connection, cursor


def test_a_query_runs_read_only_in_a_rolled_back_transaction() -> None:
    executor, connection, cursor = _executor([("paid", Decimal("12"))], ("status", "orders"))
    compiled = _compiled(dimensions=("status",), measures=("orders",))
    rows = executor.execute(compiled)
    assert rows.columns == ("status", "orders")
    assert rows.rows == (("paid", 12),)
    assert connection.statements[0] == "SET TRANSACTION READ ONLY"
    assert "statement_timeout', '30000'" in connection.statements[1]
    assert "'TimeZone', 'UTC'" in connection.statements[1]
    assert connection.rolled_back
    assert cursor.executed == [(compiled.sql, ["acme"])]


def test_a_result_beyond_the_row_ceiling_is_refused() -> None:
    executor, _, _ = _executor([("a", 1)] * 5, ("status", "orders"))
    compiled = replace(
        _compiled(dimensions=("status",), measures=("orders",)),
        settings=query_settings(max_result_rows=4),
    )
    with pytest.raises(CompiledQueryError) as refused:
        executor.execute(compiled)
    assert refused.value.category == "too-large"


def test_a_cancelled_query_reports_cancellation() -> None:
    executor, _, _ = _executor([("a", 1)], ("status", "orders"))
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(CompiledQueryError) as stopped:
        executor.execute(replace(_compiled(measures=("orders",)), cancellation=cancelled))
    assert stopped.value.category == "aborted"


def test_clients_plan_with_their_executors_dialect() -> None:
    executor, _, cursor = _executor([(3,)], ("orders",))
    client = create_dataset_client(executor=executor, registry=REGISTRY)
    result = client.execute(Orders, {"measures": ("orders",)}, context=ACME, use_cache=False)
    assert result.data == ({"orders": 3},)
    assert '"analytics"."orders"' in cursor.executed[0][0]
