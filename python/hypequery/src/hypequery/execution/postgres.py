"""Postgres execution for compiled dataset queries.

Importing this module does not import the optional driver or open a
connection. Install ``hypequery[postgres]`` to use it.

Each query runs in its own read-only transaction that pins what the compiled
SQL relies on: a UTC session zone (a zone-less ``timestamp`` is read as UTC),
standard-conforming strings, and a server-side statement timeout from the
compiled settings and deadline. Values travel as server-side parameters
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


def _arguments(compiled: CompiledQuery) -> tuple[list[object], int, int]:
    """The positional values, the statement timeout (ms) and the row ceiling.

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
    return [parameter.value for parameter in parameters], timeout_ms, settings["max_result_rows"]


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


def _setup_sql(timeout_ms: int) -> str:
    """Transaction-local settings, in one statement (psycopg sends one per call).

    The timeout is an integer formatted with `:d`; nothing else reaches this text.
    """

    return (
        f"SELECT set_config('statement_timeout', '{timeout_ms:d}', true), "
        "set_config('TimeZone', 'UTC', true), "
        "set_config('standard_conforming_strings', 'on', true)"
    )


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


class PostgresExecutor:
    """Execute trusted compiled SELECTs on Postgres with server-side parameters."""

    #: Clients plan with the executor's dialect.
    dialect: PostgresDialect = POSTGRES

    def __init__(
        self,
        connect: Callable[[], AbstractContextManager[psycopg.Connection[Any]]],
        *,
        cursor: Callable[[psycopg.Connection[Any]], Any] | None = None,
    ) -> None:
        self._connect = connect
        #: Server-side `$n` binding; injectable for tests.
        self._cursor = cursor

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        import psycopg

        values, timeout_ms, max_rows = _arguments(compiled)
        query_id = compiled.query_id
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
                        connection.execute(_setup_sql(timeout_ms))
                        cursor = (self._cursor or psycopg.RawCursor)(connection)
                        cursor.execute(compiled.sql, values)
                        rows = cursor.fetchmany(max_rows + 1)
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
        if len(rows) > max_rows:
            raise _too_large(query_id)
        return _decode(description, rows, query_id)

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
        self, connect: Callable[[], AbstractAsyncContextManager[psycopg.AsyncConnection[Any]]]
    ) -> None:
        self._connect = connect

    async def execute(self, compiled: CompiledQuery) -> QueryRows:
        values, timeout_ms, max_rows = _arguments(compiled)
        work = asyncio.ensure_future(self._run(compiled, values, timeout_ms, max_rows))
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
        self, compiled: CompiledQuery, values: list[object], timeout_ms: int, max_rows: int
    ) -> QueryRows:
        import psycopg

        query_id = compiled.query_id
        try:
            async with (
                self._connect() as connection,
                connection.transaction(force_rollback=True),
            ):
                await connection.execute(_READ_ONLY)
                await connection.execute(_setup_sql(timeout_ms))
                cursor = psycopg.AsyncRawCursor(connection)
                await cursor.execute(compiled.sql, values)
                rows = await cursor.fetchmany(max_rows + 1)
                description = cursor.description
        except (CompiledQueryError, asyncio.CancelledError):
            raise
        except Exception as exc:
            raise (terminal_error(compiled) or safe_postgres_error(exc, query_id)) from None
        if len(rows) > max_rows:
            raise _too_large(query_id)
        return _decode(description, rows, query_id)

    async def close(self) -> None:
        """Nothing is held between queries; a pool belongs to its owner."""


def create_postgres_executor(
    connection: PostgresConnection | str | None = None,
    *,
    pool: Any = None,
) -> PostgresExecutor:
    """A blocking executor over a new connection per query, or *pool*'s connections.

    Pass a ``psycopg_pool.ConnectionPool`` as *pool* to reuse connections.
    """

    if pool is not None:
        return PostgresExecutor(pool.connection)
    import psycopg

    conninfo = _conninfo(connection)

    @contextmanager
    def connect() -> Iterator[psycopg.Connection[Any]]:
        with psycopg.connect(conninfo) as opened:
            yield opened

    return PostgresExecutor(connect)


async def create_async_postgres_executor(
    connection: PostgresConnection | str | None = None,
    *,
    pool: Any = None,
) -> AsyncPostgresExecutor:
    """An async executor. Pass a ``psycopg_pool.AsyncConnectionPool`` as *pool* to reuse
    connections."""

    if pool is not None:
        return AsyncPostgresExecutor(pool.connection)
    import psycopg

    conninfo = _conninfo(connection)

    @asynccontextmanager
    async def connect() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
        async with await psycopg.AsyncConnection.connect(conninfo) as opened:
            yield opened

    return AsyncPostgresExecutor(connect)


def _conninfo(connection: PostgresConnection | str | None) -> str:
    if connection is None:
        return PostgresConnection.from_env().conninfo
    return connection if isinstance(connection, str) else connection.conninfo
