"""Postgres execution for compiled dataset queries.

Importing this module does not import the optional driver or open a
connection. Install ``hypequery[postgres]`` to use it.

Each query runs in its own read-only transaction that pins what the compiled
SQL relies on: a UTC session zone (a zone-less ``timestamp`` is read as UTC),
standard-conforming strings, a server-side statement timeout from the
compiled settings and deadline, a parallel-worker ceiling from ``max_threads``,
and optionally a pinned ``search_path``. Rows come through a server-side cursor
in batches, so a result past ``max_result_rows`` or ``max_result_bytes`` stops
on the server instead of being sent whole.
Nothing outlives the transaction and no statement is prepared by name, as a
transaction-mode pooler such as PgBouncer requires. Values travel as server-side parameters
(``$n``, never interpolated), so a statement is exactly one statement.
"""

from __future__ import annotations

import asyncio
import math
import os
import re
import threading
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from contextlib import (
    AbstractAsyncContextManager,
    AbstractContextManager,
    asynccontextmanager,
    contextmanager,
    suppress,
)
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final, Self, cast

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError
from hypequery.datasets.planner.dialects import POSTGRES, PostgresDialect
from hypequery.datasets.planner.settings import SETTING_DEFINITIONS

from .cancellation import terminal_error
from .results import QueryRows, decode_result

if TYPE_CHECKING:
    import psycopg

__all__ = [
    "AsyncPostgresExecutor",
    "PostgresConnection",
    "PostgresExecutor",
    "create_async_postgres_executor",
    "create_postgres_executor",
]

_PLACEHOLDER: Final = re.compile(r"\$([1-9][0-9]*)")
_NAME: Final = re.compile(r"p(?:0|[1-9][0-9]*)\Z")
#: How often a running query checks its cancellation and deadline.
_POLL_SECONDS: Final = 0.025


@dataclass(frozen=True, slots=True)
class PostgresConnection:
    """Where to connect: a libpq connection string or ``postgresql://`` URL."""

    conninfo: str = field(repr=False)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Self:
        """Read ``HYPEQUERY_POSTGRES_URL``, falling back to ``DATABASE_URL``."""

        environ = os.environ if environ is None else environ
        conninfo = environ.get("HYPEQUERY_POSTGRES_URL") or environ.get("DATABASE_URL")
        if not conninfo:
            raise ValueError(
                "Set HYPEQUERY_POSTGRES_URL (or DATABASE_URL) to a Postgres connection URL."
            )
        return cls(conninfo)


@dataclass(frozen=True, slots=True)
class _Limits:
    """What one execution may spend, from the compiled settings and deadline."""

    timeout_ms: int
    max_rows: int
    max_bytes: int
    #: `max_threads` counts the leader; Postgres counts only the extra workers.
    max_parallel_workers: int


def _arguments(compiled: CompiledQuery) -> tuple[list[object], _Limits]:
    """The positional values and the execution limits.

    Re-checks the compiled query at the adapter boundary: the statement must be
    a Postgres SELECT whose `$n` placeholders are exactly the declared
    parameters, in order, and the settings must be the closed allow-list.
    """

    reason = terminal_error(compiled)
    if reason is not None:
        raise reason
    query_id = compiled.query_id
    if compiled.operation != "query" or compiled.dialect != POSTGRES.name:
        raise CompiledQueryError("internal", "invalid compiled query", query_id=query_id)
    if type(compiled.sql) is not str or not compiled.sql.lstrip().upper().startswith("SELECT "):
        raise CompiledQueryError("internal", "invalid compiled query", query_id=query_id)
    parameters = list(compiled.parameters.values())
    used = {int(index) for index in _PLACEHOLDER.findall(compiled.sql)}
    if used != set(range(1, len(parameters) + 1)):
        raise CompiledQueryError("internal", "invalid parameter", query_id=query_id)
    for index, parameter in enumerate(parameters):
        if (
            not _NAME.fullmatch(parameter.name)
            or parameter.name != f"p{index}"
            or parameter.placeholder != f"${index + 1}"
            or not _valid_value(parameter.value)
        ):
            raise CompiledQueryError("internal", "invalid parameter", query_id=query_id)
    settings = dict(compiled.settings.values)
    if set(settings) != set(SETTING_DEFINITIONS) or any(
        type(value) is not int
        or not SETTING_DEFINITIONS[name].minimum <= value <= SETTING_DEFINITIONS[name].maximum
        for name, value in settings.items()
    ):
        raise CompiledQueryError("internal", "invalid query settings", query_id=query_id)
    timeout_ms = settings["max_execution_time"] * 1000
    if compiled.deadline is not None:
        remaining = compiled.deadline.remaining()
        timeout_ms = max(1, min(timeout_ms, math.ceil(remaining * 1000)))
    limits = _Limits(
        timeout_ms=timeout_ms,
        max_rows=settings["max_result_rows"],
        max_bytes=settings["max_result_bytes"],
        max_parallel_workers=settings["max_threads"] - 1,
    )
    return [parameter.value for parameter in parameters], limits


def _valid_value(value: object) -> bool:
    if value is None or type(value) in (str, bool, int, Decimal, datetime):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) in (list, tuple):
        items = cast(Sequence[object], value)
        return all(_valid_value(item) and type(item) not in (list, tuple) for item in items)
    return False


#: The first statement of every transaction: nothing it runs can write.
_READ_ONLY: Final = "SET TRANSACTION READ ONLY"


_SETUP_SQL: Final = (
    "SELECT set_config('statement_timeout', %s, true), "
    "set_config('TimeZone', 'UTC', true), "
    "set_config('standard_conforming_strings', 'on', true), "
    "set_config('search_path', coalesce(%s, current_setting('search_path')), true), "
    # A ceiling only: never more parallel workers than the server already allows.
    "set_config('max_parallel_workers_per_gather', "
    "least(%s::int, current_setting('max_parallel_workers_per_gather')::int)::text, true)"
)


def _setup(limits: _Limits, search_path: str | None) -> tuple[str, list[object]]:
    """Transaction-local settings in one bound statement (psycopg sends one per call)."""

    return _SETUP_SQL, [str(limits.timeout_ms), search_path, limits.max_parallel_workers]


def pinned_search_path(schemas: Sequence[str]) -> str:
    """The ``search_path`` value that pins name resolution to *schemas*.

    ``pg_catalog`` comes first, so a function with a built-in's exact signature
    in a listed schema can't replace the built-in, and ``pg_temp`` comes last,
    so a temporary table can't shadow a source table. Postgres still weighs
    overloads with other argument types from every listed schema, so list only
    schemas that untrusted roles cannot create objects in.
    """

    if isinstance(schemas, str):
        raise TypeError("search_path must be a sequence of schema names, not a string.")
    quoted: list[str] = []
    for schema in schemas:
        if type(schema) is not str or not schema or "\x00" in schema:
            raise ValueError("search_path must list non-empty schema names.")
        if schema in ("pg_catalog", "pg_temp"):
            raise ValueError(f"search_path must not list {schema}; it is placed automatically.")
        quoted.append(POSTGRES.quote(schema))
    return ", ".join(["pg_catalog", *quoted, "pg_temp"])


def _normalize(value: object) -> object:
    """Postgres values as the ClickHouse driver would hand them to the result codec.

    `numeric` is what Postgres returns for `SUM(bigint)` and `AVG`: an integral
    sum becomes an int (ClickHouse `sum` over integers), anything with a
    fractional part a float (ClickHouse `avg` is Float64). A zone-less
    `timestamp` is UTC, the session zone.
    """

    if type(value) is Decimal:
        if not value.is_finite():
            return None
        exponent = value.as_tuple().exponent
        return int(value) if isinstance(exponent, int) and exponent >= 0 else float(value)
    if type(value) is datetime and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


@dataclass(frozen=True, slots=True)
class _Rows:
    column_names: tuple[str, ...]
    result_rows: list[tuple[object, ...]]


def _decode(
    description: Sequence[Any] | None, rows: list[tuple[object, ...]], query_id: str
) -> QueryRows:
    columns = tuple(column.name for column in description or ())
    normalized = [tuple(_normalize(value) for value in row) for row in rows]
    return decode_result(_Rows(columns, normalized), query_id)


def _too_large(query_id: str) -> CompiledQueryError:
    return CompiledQueryError("too-large", "The query result is too large.", query_id=query_id)


#: Rows fetched from the server cursor per round trip.
_FETCH_BATCH: Final = 1_000
#: The server-side cursor every query runs through; one per transaction.
_CURSOR_NAME: Final = "_hq_rows"


def _value_bytes(value: object) -> int:
    """An approximate in-memory size, for the ``max_result_bytes`` ceiling."""

    if value is None:
        return 1
    if isinstance(value, str):
        return len(value.encode())
    if isinstance(value, (bytes, bytearray, memoryview)):
        return len(value)
    if isinstance(value, (list, tuple)):
        return 8 + sum(_value_bytes(item) for item in cast(Sequence[object], value))
    if isinstance(value, dict):
        items = cast(Mapping[object, object], value).items()
        return 8 + sum(_value_bytes(key) + _value_bytes(item) for key, item in items)
    if isinstance(value, Decimal):
        return 16
    return 8


class _Budget:
    """Counts fetched rows and bytes; refuses a result past either ceiling."""

    def __init__(self, limits: _Limits, query_id: str) -> None:
        self._limits = limits
        self._query_id = query_id
        self.rows: list[tuple[object, ...]] = []
        self._bytes = 0

    def next_batch(self) -> int:
        """How many rows to ask for next: one past the ceiling at most."""

        return min(_FETCH_BATCH, self._limits.max_rows + 1 - len(self.rows))

    def add(self, batch: Sequence[tuple[object, ...]], requested: int) -> bool:
        """Keep *batch*; True while more rows may follow (a full batch came back)."""

        self.rows.extend(batch)
        if len(self.rows) > self._limits.max_rows:
            raise _too_large(self._query_id)
        self._bytes += sum(_value_bytes(value) for row in batch for value in row)
        if self._bytes > self._limits.max_bytes:
            raise _too_large(self._query_id)
        return len(batch) == requested


def safe_postgres_error(exc: Exception, query_id: str) -> CompiledQueryError:
    """The public error for a failed driver call, never the driver's own text."""

    import psycopg
    from psycopg import errors

    if isinstance(exc, errors.QueryCanceled):
        return CompiledQueryError("deadline-exceeded", "The query timed out.", query_id=query_id)
    if isinstance(exc, (errors.InvalidPassword, errors.InvalidAuthorizationSpecification)):
        return CompiledQueryError(
            "unauthenticated", "Postgres authentication failed.", query_id=query_id
        )
    if isinstance(exc, (errors.InsufficientPrivilege, errors.ReadOnlySqlTransaction)):
        return CompiledQueryError("forbidden", "Postgres access was denied.", query_id=query_id)
    if isinstance(
        exc, (errors.InvalidCatalogName, errors.UndefinedTable, errors.InvalidSchemaName)
    ):
        return CompiledQueryError(
            "not-found", "A Postgres relation does not exist.", query_id=query_id
        )
    if isinstance(exc, (psycopg.OperationalError, ConnectionError, TimeoutError, OSError)):
        return CompiledQueryError("unavailable", "", query_id=query_id)
    return CompiledQueryError("internal", "", query_id=query_id)


def _server_cursor(connection: psycopg.Connection[Any]) -> Any:
    import psycopg

    return psycopg.RawServerCursor(connection, _CURSOR_NAME, scrollable=False)


class PostgresExecutor:
    """Execute trusted compiled SELECTs on Postgres with server-side parameters."""

    #: Clients plan with the executor's dialect.
    dialect: PostgresDialect = POSTGRES

    def __init__(
        self,
        connect: Callable[[], AbstractContextManager[psycopg.Connection[Any]]],
        *,
        cursor: Callable[[psycopg.Connection[Any]], Any] | None = None,
        search_path: Sequence[str] | None = None,
    ) -> None:
        self._connect = connect
        #: Server-side `$n` binding; injectable for tests.
        self._cursor = cursor
        self._search_path = None if search_path is None else pinned_search_path(search_path)

    def execute(self, compiled: CompiledQuery) -> QueryRows:

        values, limits = _arguments(compiled)
        query_id = compiled.query_id
        budget = _Budget(limits, query_id)
        try:
            with self._connect() as connection:
                done = threading.Event()
                watcher = threading.Thread(
                    target=_watch, args=(compiled, connection, done), daemon=True
                )
                watcher.start()
                try:
                    # Read-only: nothing to keep, so the transaction never commits.
                    with connection.transaction(force_rollback=True):
                        connection.execute(_READ_ONLY)
                        # Unnamed statements only, as a transaction-mode pooler requires.
                        connection.execute(*_setup(limits, self._search_path), prepare=False)
                        # A server-side cursor: the server stops at the ceiling
                        # instead of sending the whole result.
                        cursor = (self._cursor or _server_cursor)(connection)
                        cursor.execute(compiled.sql, values)
                        while budget.add(cursor.fetchmany(size := budget.next_batch()), size):
                            pass
                        description = cursor.description
                finally:
                    done.set()
        except CompiledQueryError:
            raise
        except Exception as exc:
            raise (terminal_error(compiled) or safe_postgres_error(exc, query_id)) from None
        reason = terminal_error(compiled)
        if reason is not None:
            raise reason
        return _decode(description, budget.rows, query_id)

    def close(self) -> None:
        """Nothing is held between queries; a pool belongs to its owner."""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def _watch(
    compiled: CompiledQuery, connection: psycopg.Connection[Any], done: threading.Event
) -> None:
    """Cancel the running statement on the server once the caller stops waiting."""

    while not done.wait(_POLL_SECONDS):
        if terminal_error(compiled) is not None:
            # Best effort: the statement's own error path reports the outcome.
            with suppress(Exception):
                connection.cancel_safe(timeout=2)
            return


class AsyncPostgresExecutor:
    """Async execution on psycopg's async connections, cancelled on the server when stopped."""

    dialect: PostgresDialect = POSTGRES

    def __init__(
        self,
        connect: Callable[[], AbstractAsyncContextManager[psycopg.AsyncConnection[Any]]],
        *,
        search_path: Sequence[str] | None = None,
    ) -> None:
        self._connect = connect
        self._search_path = None if search_path is None else pinned_search_path(search_path)

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        values, limits = _arguments(compiled)
        work = asyncio.ensure_future(self._run(compiled, values, limits))
        try:
            while True:
                done, _ = await asyncio.wait((work,), timeout=_POLL_SECONDS)
                reason = terminal_error(compiled)
                if reason is not None:
                    # psycopg sends a server cancel when its awaiting task is cancelled.
                    work.cancel()
                    await asyncio.gather(work, return_exceptions=True)
                    raise reason
                if done:
                    return work.result()
        except asyncio.CancelledError:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            raise

    async def _run(
        self, compiled: CompiledQuery, values: list[object], limits: _Limits
    ) -> QueryRows:
        import psycopg

        query_id = compiled.query_id
        budget = _Budget(limits, query_id)
        try:
            async with (
                self._connect() as connection,
                connection.transaction(force_rollback=True),
            ):
                await connection.execute(_READ_ONLY)
                await connection.execute(*_setup(limits, self._search_path), prepare=False)
                cursor = psycopg.AsyncRawServerCursor(connection, _CURSOR_NAME, scrollable=False)
                await cursor.execute(compiled.sql, values)
                while budget.add(await cursor.fetchmany(size := budget.next_batch()), size):
                    pass
                description = cursor.description
        except (CompiledQueryError, asyncio.CancelledError):
            raise
        except Exception as exc:
            raise (terminal_error(compiled) or safe_postgres_error(exc, query_id)) from None
        return _decode(description, budget.rows, query_id)

    async def close(self) -> None:
        """Nothing is held between queries; a pool belongs to its owner."""


def create_postgres_executor(
    connection: PostgresConnection | str | None = None,
    *,
    pool: Any = None,
    search_path: Sequence[str] | None = None,
) -> PostgresExecutor:
    """A blocking executor over a new connection per query, or *pool*'s connections.

    Pass a ``psycopg_pool.ConnectionPool`` as *pool* to reuse connections.
    *search_path* pins name resolution for every query to those schemas (see
    `pinned_search_path`); unset, the session's own ``search_path`` applies.
    """

    if pool is not None:
        return PostgresExecutor(pool.connection, search_path=search_path)
    import psycopg

    conninfo = _conninfo(connection)

    @contextmanager
    def connect() -> Iterator[psycopg.Connection[Any]]:
        with psycopg.connect(conninfo) as opened:
            yield opened

    return PostgresExecutor(connect, search_path=search_path)


async def create_async_postgres_executor(
    connection: PostgresConnection | str | None = None,
    *,
    pool: Any = None,
    search_path: Sequence[str] | None = None,
) -> AsyncPostgresExecutor:
    """An async executor. Pass a ``psycopg_pool.AsyncConnectionPool`` as *pool* to reuse
    connections; *search_path* is as for `create_postgres_executor`."""

    if pool is not None:
        return AsyncPostgresExecutor(pool.connection, search_path=search_path)
    import psycopg

    conninfo = _conninfo(connection)

    @asynccontextmanager
    async def connect() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
        async with await psycopg.AsyncConnection.connect(conninfo) as opened:
            yield opened

    return AsyncPostgresExecutor(connect, search_path=search_path)


def _conninfo(connection: PostgresConnection | str | None) -> str:
    if connection is None:
        return PostgresConnection.from_env().conninfo
    return connection if isinstance(connection, str) else connection.conninfo
