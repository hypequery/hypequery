"""Read-only ClickHouse schema discovery, independent of scaffold writes."""

from __future__ import annotations

import os
from contextlib import suppress
from dataclasses import dataclass
from importlib.util import find_spec
from typing import Protocol, cast

from ..errors import CliError


@dataclass(frozen=True)
class Column:
    name: str
    type: str


@dataclass(frozen=True)
class Table:
    name: str
    columns: tuple[Column, ...]


@dataclass(frozen=True)
class Schema:
    database: str
    tables: tuple[Table, ...]


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

    client: _Client | None = None
    try:
        client = cast(
            _Client,
            clickhouse_connect.get_client(
                host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
                port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
                database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
                username=os.environ.get("CLICKHOUSE_USERNAME", "default"),
                password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
                secure=os.environ.get("CLICKHOUSE_SECURE", "false").lower() == "true",
                connect_timeout=5,
                send_receive_timeout=15,
            ),
        )
        return read_schema(client, tables=tables, exclude_tables=exclude_tables)
    except CliError:
        raise
    except Exception as exc:
        raise CliError(
            "Cannot inspect ClickHouse; check connection settings, credentials "
            "and catalog permissions."
        ) from exc
    finally:
        if client is not None:
            with suppress(Exception):
                client.close()


def read_schema(client: _Client, *, tables: str | None, exclude_tables: str | None) -> Schema:
    """Use parameterized catalog queries, including exact selected-table checks."""
    settings = {"readonly": 1, "max_execution_time": 15, "max_result_rows": 100_001}
    database_rows = client.query(
        "SELECT currentDatabase()", parameters={}, settings=settings
    ).result_rows
    database = str(database_rows[0][0])
    rows = client.query(
        "SELECT name FROM system.tables WHERE database = {database:String} ORDER BY name",
        parameters={"database": database},
        settings=settings,
    ).result_rows
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
        "ORDER BY table, position",
        parameters={"database": database, "tables": selected},
        settings=settings,
    ).result_rows
    if len(column_rows) > 100_000:
        raise CliError("Schema exceeds the discovery limit; select fewer tables with --tables.")
    grouped: dict[str, list[Column]] = {name: [] for name in selected}
    for table, name, type_name in column_rows:
        grouped[str(table)].append(Column(str(name), str(type_name)))
    if any(not columns for columns in grouped.values()):
        raise CliError("A selected table has no visible columns; check catalog permissions.")
    return Schema(database, tuple(Table(name, tuple(columns)) for name, columns in grouped.items()))
