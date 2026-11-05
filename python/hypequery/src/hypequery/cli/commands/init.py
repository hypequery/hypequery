"""Create a Python dataset project without network calls or database writes.

In a terminal, init asks for whatever the flags left unset (see
``guided_init``); in scripts and CI it never asks and uses the defaults.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import cast

from ..errors import CliError
from ..generators.chdb_project import DEFAULT_CHDB_PATH, chdb_templates, require_chdb_framework
from ..generators.framework_apps import RUN_COMMAND, Framework, offline_templates, project_files
from ..guided_init import TypedConnection, can_guide, env_lines, guide
from ..options import InitOptions
from ..scaffold import Scaffold
from ..utils.next_steps import cd_prefix
from ..utils.prompts import Prompter, SetupCancelledError
from ..utils.recorded_selection import TableSelection
from ..utils.templates import load_templates


def run(options: InitOptions) -> None:
    environ: Mapping[str, str] | None = None
    typed: TypedConnection | None = None
    if can_guide(options):
        try:
            guided = guide(options, Prompter(), cwd=Path.cwd(), environ=os.environ)
        except SetupCancelledError:
            print("\nSetup cancelled; nothing was created.")
            return
        options, environ, typed = guided.options, guided.environ, guided.typed
    options = replace(
        options,
        directory=options.directory or ".",
        framework=options.framework or "standalone",
    )
    destination = _create(options, environ)
    if typed is not None:
        print(
            f"Add your connection to {destination / '.env'} (gitignored) so hypequery dev "
            "and generate datasets can connect:"
        )
        for line in env_lines(typed):
            print(f"  {line}")
    _next_steps(destination, cast(Framework, options.framework), chdb=options.database == "chdb")


def _create(options: InitOptions, environ: Mapping[str, str] | None) -> Path:
    framework = cast(Framework, options.framework)
    scaffold = Scaffold(Path(cast(str, options.directory)))
    chdb_path = _chdb_path(options, framework)
    # Lexically: the project directory may not exist yet for `..` to pass through.
    database_dir = (
        None if chdb_path is None else Path(os.path.normpath(scaffold.destination / chdb_path))
    )
    schema_options = (
        options.tables or options.exclude_tables or options.all_tables or options.tenant_column
    )
    if database_dir is not None and not database_dir.is_dir() and schema_options:
        # The parser refuses these with --skip-connection; a missing database is
        # the same situation, and must not quietly give the example instead.
        raise CliError(
            f"There is no chDB database at {chdb_path} yet, so table selection and "
            "--tenant-column cannot be applied. Create and seed it first, or leave them "
            "out to get the orders example."
        )
    if options.skip_connection or (database_dir is not None and not database_dir.is_dir()):
        templates = offline_templates(load_templates(), framework)
        if chdb_path is not None:
            templates = chdb_templates(templates, framework, chdb_path)
        destination = scaffold.create(templates)
        if chdb_path is None:
            print("Created an offline orders example; no database schema was inspected.")
        else:
            print(
                f"Created the orders example on embedded ClickHouse; {chdb_path} does not exist "
                "yet, and README.md shows how to create it from seed.sql."
            )
    else:
        from ..generators.datasets import generate_datasets, is_identifier
        from ..generators.project import schema_templates
        from ..generators.schema import DiscoveryConnectionError, discover_schema

        if options.tenant_column is not None and not is_identifier(options.tenant_column):
            raise CliError("The tenant column is outside the SDK's supported identifier grammar.")
        # Refuse collisions before making a database connection.
        scaffold.preflight(project_files(framework, offline=False))
        try:
            schema = discover_schema(
                tables=options.tables,
                exclude_tables=options.exclude_tables,
                environ=environ,
                chdb_path=database_dir,
            )
        except DiscoveryConnectionError as exc:
            raise DiscoveryConnectionError(
                f"{exc} To create the project without a database, add --skip-connection."
            ) from exc
        selection = TableSelection(options.tables, options.exclude_tables).snapshot()
        generated = generate_datasets(
            schema,
            tenant_column=options.tenant_column,
            selection=selection,
        )
        templates = schema_templates(load_templates(), schema, generated, framework)
        if chdb_path is not None:
            templates = chdb_templates(templates, framework, chdb_path)
        destination = scaffold.create(templates)
        print(f"Inspected {schema.database}: generated {len(generated.tables)} datasets.")
        for warning in generated.warnings:
            print(f"Review: {warning}")
    print(f"Created Python dataset project in {destination}")
    return destination


def _chdb_path(options: InitOptions, framework: Framework) -> str | None:
    """The chDB database directory relative to the project, or ``None`` for a server."""

    if options.database != "chdb":
        return None
    require_chdb_framework(framework)
    return options.chdb_path or DEFAULT_CHDB_PATH


def _next_steps(destination: Path, framework: Framework, *, chdb: bool) -> None:
    if chdb:
        credentials = "create the chDB database if it is new"
    elif framework == "standalone":
        credentials = "set your connection settings (the API is open for local development)"
    else:
        credentials = "configure serving credentials"
    print(
        f"Next: follow README.md to install dependencies, {credentials} "
        "and review dataset definitions."
    )
    print(f"Then run: {cd_prefix(destination)}{RUN_COMMAND[framework]}")
