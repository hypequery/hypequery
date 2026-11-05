"""Typed options for each command, built once from the parsed arguments.

argparse yields an untyped namespace. Converting it here means a misspelled
option is a type error in the command, not an AttributeError at run time.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Literal, TypeAlias

#: Where the datasets' tables live: a ClickHouse server, or embedded chDB.
Database: TypeAlias = Literal["clickhouse", "chdb"]


@dataclass(frozen=True, slots=True)
class InitOptions:
    #: ``None`` when not given: guided init asks, otherwise the current directory.
    directory: str | None
    tables: str | None
    exclude_tables: str | None
    tenant_column: str | None
    #: ``None`` when not given: guided init asks, otherwise ``standalone``.
    framework: str | None
    skip_connection: bool
    all_tables: bool = False
    #: Whether init may ask questions; only in a terminal, and never when CI is set.
    interactive: bool = True
    database: Database = "clickhouse"
    #: The chDB database directory, relative to the project; ``None`` for the default.
    chdb_path: str | None = None


@dataclass(frozen=True, slots=True)
class GenerateDatasetsOptions:
    output: str | None
    path: str | None
    tables: str | None
    exclude_tables: str | None
    tenant_column: str | None
    no_tenant_column: bool
    all_tables: bool
    check: bool
    diff: bool
    force: bool
    #: ``None`` when not given: the database schema.json records, else ClickHouse.
    database: Database | None = None
    chdb_path: str | None = None


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
            tenant_column=args.tenant_column,
            framework=args.framework,
            skip_connection=args.skip_connection,
            all_tables=args.all_tables,
            interactive=not args.no_interactive,
            database=args.database or "clickhouse",
            chdb_path=args.chdb_path,
        )
    if args.command == "generate":
        return GenerateDatasetsOptions(
            output=args.output,
            path=args.path,
            tables=args.tables,
            exclude_tables=args.exclude_tables,
            tenant_column=args.tenant_column,
            no_tenant_column=args.no_tenant_column,
            all_tables=args.all_tables,
            check=args.check,
            diff=args.diff,
            force=args.force,
            database=args.database,
            chdb_path=args.chdb_path,
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
