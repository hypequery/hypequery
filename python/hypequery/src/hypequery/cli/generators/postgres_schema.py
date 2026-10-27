"""Read-only Postgres schema discovery for the current schema."""

from __future__ import annotations

from importlib.util import find_spec
from typing import Any

from hypequery.execution.postgres import PostgresConnection

from ..errors import CliError
from .schema import Column, Schema, Table, select_tables

_ROW_CAP = 100_000


def discover_postgres_schema(*, tables: str | None, exclude_tables: str | None) -> Schema:
    """Read the current schema's catalog in a read-only, time-limited transaction."""
    if find_spec("psycopg") is None:
        raise CliError('Schema discovery requires: pip install "hypequery[postgres]"')
    import psycopg

    try:
        conninfo = PostgresConnection.from_env().conninfo
    except ValueError as exc:
        raise CliError(str(exc)) from exc
    try:
        with (
            psycopg.connect(conninfo, connect_timeout=5) as connection,
            connection.transaction(force_rollback=True),
        ):
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute("SELECT set_config('statement_timeout', '15000', true)")
            return read_postgres_schema(connection, tables=tables, exclude_tables=exclude_tables)
    except CliError:
        raise
    except Exception as exc:
        from hypequery.execution.postgres import safe_postgres_error

        category = safe_postgres_error(exc, "").category
        hint = {
            "unauthenticated": "Check the user and password in HYPEQUERY_POSTGRES_URL.",
            "forbidden": "Grant the role USAGE on the schema and SELECT on its tables.",
            "unavailable": "Check that Postgres is running and the URL's host and port.",
        }.get(category, "Check HYPEQUERY_POSTGRES_URL and the role's catalog access.")
        raise CliError(f"Cannot inspect Postgres. {hint}") from exc


def read_postgres_schema(
    connection: Any, *, tables: str | None, exclude_tables: str | None
) -> Schema:
    """Catalog queries only, with every name bound as a parameter."""
    schema = str(connection.execute("SELECT current_schema()").fetchone()[0])
    rows = connection.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = %s AND table_type IN ('BASE TABLE', 'VIEW') "
        "ORDER BY table_name LIMIT 100001",
        (schema,),
    ).fetchall()
    if len(rows) > _ROW_CAP:
        raise CliError("The schema has more tables than discovery can list.")
    selected = select_tables(
        {str(row[0]) for row in rows}, tables=tables, exclude_tables=exclude_tables
    )
    column_rows = connection.execute(
        "SELECT table_name, column_name, data_type, is_nullable = 'YES' "
        "FROM information_schema.columns WHERE table_schema = %s AND table_name = ANY(%s) "
        "ORDER BY table_name, ordinal_position LIMIT 100001",
        (schema, selected),
    ).fetchall()
    if len(column_rows) > _ROW_CAP:
        raise CliError("Schema exceeds the discovery limit; select fewer tables with --tables.")
    grouped: dict[str, list[Column]] = {name: [] for name in selected}
    for table, name, data_type, nullable in column_rows:
        grouped[str(table)].append(Column(str(name), str(data_type), bool(nullable)))
    if any(not columns for columns in grouped.values()):
        raise CliError("A selected table has no visible columns; check catalog permissions.")
    return Schema(
        schema, tuple(Table(name, tuple(columns)) for name, columns in grouped.items()), "postgres"
    )
