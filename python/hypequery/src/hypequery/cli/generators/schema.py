"""Read-only ClickHouse schema discovery, independent of scaffold writes."""

from __future__ import annotations

import os
from contextlib import suppress
from dataclasses import dataclass
from importlib.util import find_spec
from typing import Protocol, cast

from hypequery.execution.utils.connection_env import connection_fields

from ..errors import CliError
from ..utils.clickhouse_hints import clickhouse_hint

#: Bounds for catalog reads. A user whose profile is readonly = 1 may not change
#: any setting, so its reads rely on each query's LIMIT 100001 and the client
#: timeout instead.
_LIMITS = {"max_execution_time": 15, "max_result_rows": 100_001}
_ROW_CAP = 100_000


@dataclass(frozen=True)
class Column:
    name: str
    type: str


@dataclass(frozen=True)
class Table:
    name: str
    columns: tuple[Column, ...]


@dataclass(frozen=True)
class ConnectionSummary:
    """How discovery connected, minus credentials, so the scaffold can repeat it."""

    host: str
    port: int | None
    secure: bool
    #: Whether the settings came from ``CLICKHOUSE_URL`` rather than the field variables.
    from_url: bool


@dataclass(frozen=True)
class Schema:
    database: str
    tables: tuple[Table, ...]
    connection: ConnectionSummary | None = None


class _Result(Protocol):
    result_rows: list[tuple[object, ...]]


class _Client(Protocol):
    def query(
        self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
    ) -> _Result: ...
    def close(self) -> None: ...


def discover_schema(*, tables: str | None, exclude_tables: str | None) -> Schema:
    """Query catalog metadata only; credentials never enter generated files."""
    if find_spec("clickhouse_connect") is None:
        raise CliError('Schema discovery requires: pip install "hypequery[clickhouse]"')
    import clickhouse_connect

    try:
        fields = connection_fields(os.environ)
    except ValueError as exc:
        # The parser's messages name the variable and never echo its value.
        raise CliError(str(exc)) from exc
    client: _Client | None = None
    try:
        client = cast(
            _Client,
            clickhouse_connect.get_client(
                **fields,
                connect_timeout=5,
                send_receive_timeout=15,
            ),
        )
        schema = read_schema(client, tables=tables, exclude_tables=exclude_tables)
        summary = ConnectionSummary(
            host=fields["host"],
            port=fields["port"],
            secure=fields["secure"],
            from_url=bool(os.environ.get("CLICKHOUSE_URL", "").strip()),
        )
        return Schema(schema.database, schema.tables, summary)
    except CliError:
        raise
    except Exception as exc:
        from hypequery.execution.errors import safe_driver_error

        error = safe_driver_error(exc, "")
        raise CliError(f"Cannot inspect ClickHouse. {clickhouse_hint(error)}") from exc
    finally:
        if client is not None:
            with suppress(Exception):
                client.close()


def _catalog_settings(client: _Client) -> dict[str, int]:
    """Ask for readonly only from a user not already read-only, as the executor does."""

    from hypequery.execution.readonly_settings import profile_readonly_level

    level = profile_readonly_level(client)
    if level == "1":
        return {}
    if level == "2":
        return dict(_LIMITS)
    return {"readonly": 1, **_LIMITS}


def read_schema(client: _Client, *, tables: str | None, exclude_tables: str | None) -> Schema:
    """Use parameterized catalog queries, including exact selected-table checks."""
    settings = _catalog_settings(client)
    database_rows = client.query(
        "SELECT currentDatabase()", parameters={}, settings=settings
    ).result_rows
    database = str(database_rows[0][0])
    rows = client.query(
        "SELECT name FROM system.tables WHERE database = {database:String} "
        "ORDER BY name LIMIT 100001",
        parameters={"database": database},
        settings=settings,
    ).result_rows
    if len(rows) > _ROW_CAP:
        # The LIMIT cut the list; discovering from part of it would be silently wrong.
        raise CliError("The database has more tables than discovery can list.")
    available = {str(row[0]) for row in rows if not str(row[0]).startswith(".inner")}
    include = {name.strip() for name in tables.split(",") if name.strip()} if tables else available
    exclude = (
        {name.strip() for name in exclude_tables.split(",") if name.strip()}
        if exclude_tables
        else set()
    )
    missing = include - available
    if missing:
        raise CliError(f"Requested tables do not exist: {', '.join(sorted(missing))}")
    selected = sorted(include - exclude)
    if not selected:
        raise CliError("No tables match the selection in this database.")
    column_rows = client.query(
        "SELECT table, name, type FROM system.columns "
        "WHERE database = {database:String} AND table IN {tables:Array(String)} "
        "ORDER BY table, position LIMIT 100001",
        parameters={"database": database, "tables": selected},
        settings=settings,
    ).result_rows
    if len(column_rows) > _ROW_CAP:
        raise CliError("Schema exceeds the discovery limit; select fewer tables with --tables.")
    grouped: dict[str, list[Column]] = {name: [] for name in selected}
    for table, name, type_name in column_rows:
        grouped[str(table)].append(Column(str(name), str(type_name)))
    if any(not columns for columns in grouped.values()):
        raise CliError("A selected table has no visible columns; check catalog permissions.")
    return Schema(database, tuple(Table(name, tuple(columns)) for name, columns in grouped.items()))
