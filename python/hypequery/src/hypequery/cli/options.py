"""Typed options for each command, built once from the parsed arguments.

argparse yields an untyped namespace. Converting it here means a misspelled
option is a type error in the command, not an AttributeError at run time.
"""

from __future__ import annotations

import argparse
import os
from collections.abc import Mapping
from dataclasses import dataclass


def resolve_database(flag: str | None, environ: Mapping[str, str] | None = None) -> str:
    """The engine to inspect: the flag, else Postgres when only a Postgres URL is set."""

    if flag is not None:
        return flag
    environ = os.environ if environ is None else environ
    if any(name.startswith("CLICKHOUSE_") and environ[name] for name in environ):
        return "clickhouse"
    url = environ.get("HYPEQUERY_POSTGRES_URL") or environ.get("DATABASE_URL") or ""
    return "postgres" if url.startswith(("postgres://", "postgresql://")) else "clickhouse"


@dataclass(frozen=True, slots=True)
class InitOptions:
    directory: str
    tables: str | None
    exclude_tables: str | None
    skip_connection: bool
    database: str = "clickhouse"


@dataclass(frozen=True, slots=True)
class GenerateDatasetsOptions:
    output: str | None
    path: str | None
    tables: str | None
    exclude_tables: str | None
    tenant_column: str | None
    check: bool
    diff: bool
    force: bool
    database: str = "clickhouse"


@dataclass(frozen=True, slots=True)
class DevOptions:
    app: str
    host: str
    port: int
    reload: bool


@dataclass(frozen=True, slots=True)
class ExportClientContractOptions:
    factory: str
    output: str | None
    stdout: bool
    check: bool
    force: bool


CommandOptions = InitOptions | GenerateDatasetsOptions | DevOptions | ExportClientContractOptions


def command_options(args: argparse.Namespace) -> CommandOptions:
    """The typed options for the command *args* selects."""

    if args.command == "init":
        return InitOptions(
            directory=args.directory,
            tables=args.tables,
            exclude_tables=args.exclude_tables,
            skip_connection=args.skip_connection,
            database=resolve_database(args.database),
        )
    if args.command == "generate":
        return GenerateDatasetsOptions(
            output=args.output,
            path=args.path,
            tables=args.tables,
            exclude_tables=args.exclude_tables,
            tenant_column=args.tenant_column,
            check=args.check,
            diff=args.diff,
            force=args.force,
            database=resolve_database(args.database),
        )
    if args.command == "export":
        return ExportClientContractOptions(
            factory=args.factory,
            output=args.output,
            stdout=args.stdout or args.output == "-",
            check=args.check,
            force=args.force,
        )
    if args.command == "dev":
        return DevOptions(app=args.app, host=args.host, port=args.port, reload=args.reload)
    raise ValueError(f"unknown command {args.command!r}")
