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
    _next_steps(destination, cast(Framework, options.framework))


def _create(options: InitOptions, environ: Mapping[str, str] | None) -> Path:
    framework = cast(Framework, options.framework)
    scaffold = Scaffold(Path(cast(str, options.directory)))
    if options.skip_connection:
        destination = scaffold.create(offline_templates(load_templates(), framework))
        print("Created an offline orders example; no database schema was inspected.")
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
                tables=options.tables, exclude_tables=options.exclude_tables, environ=environ
            )
        except DiscoveryConnectionError as exc:
            raise DiscoveryConnectionError(
                f"{exc} To create the project without a database, add --skip-connection."
            ) from exc
        selection = TableSelection(options.tables, options.exclude_tables).snapshot()
        generated = generate_datasets(
            schema, tenant_column=options.tenant_column, selection=selection
        )
        destination = scaffold.create(
            schema_templates(load_templates(), schema, generated, framework)
        )
        print(f"Inspected {schema.database}: generated {len(generated.tables)} datasets.")
        for warning in generated.warnings:
            print(f"Review: {warning}")
    print(f"Created Python dataset project in {destination}")
    return destination


def _next_steps(destination: Path, framework: Framework) -> None:
    credentials = (
        "set your connection settings (the API is open for local development)"
        if framework == "standalone"
        else "configure serving credentials"
    )
    print(
        f"Next: follow README.md to install dependencies, {credentials} "
        "and review dataset definitions."
    )
    print(f"Then run: {cd_prefix(destination)}{RUN_COMMAND[framework]}")
