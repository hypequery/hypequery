"""Typed options for each command, built once from the parsed arguments.

argparse yields an untyped namespace. Converting it here means a misspelled
option is a type error in the command, not an AttributeError at run time.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class InitOptions:
    directory: str
    tables: str | None
    exclude_tables: str | None
    skip_connection: bool


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


@dataclass(frozen=True, slots=True)
class DevOptions:
    app: str
    host: str
    port: int
    reload: bool


CommandOptions = InitOptions | GenerateDatasetsOptions | DevOptions


def command_options(args: argparse.Namespace) -> CommandOptions:
    """The typed options for the command *args* selects."""

    if args.command == "init":
        return InitOptions(
            directory=args.directory,
            tables=args.tables,
            exclude_tables=args.exclude_tables,
            skip_connection=args.skip_connection,
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
        )
    if args.command == "dev":
        return DevOptions(app=args.app, host=args.host, port=args.port, reload=args.reload)
    raise ValueError(f"unknown command {args.command!r}")
