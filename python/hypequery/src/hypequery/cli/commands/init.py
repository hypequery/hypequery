"""Create a Python dataset project without network calls or database writes."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from ..errors import CliError
from ..generators.framework_apps import APP_MODULE, RUN_COMMAND, Framework
from ..options import InitOptions
from ..scaffold import Scaffold
from ..utils.next_steps import cd_prefix
from ..utils.recorded_selection import TableSelection
from ..utils.templates import load_templates


def run(options: InitOptions) -> None:
    framework = cast(Framework, options.framework)
    scaffold = Scaffold(Path(options.directory))
    if options.skip_connection:
        destination = scaffold.create()
        print("Created an offline orders example; no database schema was inspected.")
    else:
        from ..generators.datasets import generate_datasets, is_identifier
        from ..generators.project import schema_templates
        from ..generators.schema import discover_schema

        if options.tenant_column is not None and not is_identifier(options.tenant_column):
            raise CliError("The tenant column is outside the SDK's supported identifier grammar.")
        # Refuse collisions before making a database connection.
        module = f"{APP_MODULE[framework]}.py"
        scaffold.preflight(
            [
                module,
                "datasets.py",
                "schema.json",
                "pyproject.toml",
                ".env.example",
                ".gitignore",
                "README.md",
            ]
        )
        schema = discover_schema(tables=options.tables, exclude_tables=options.exclude_tables)
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
    needs = "serving credentials" if framework == "fastapi" else "connection settings"
    print(
        f"Next: follow README.md to install dependencies, configure {needs} "
        "and review dataset definitions."
    )
    if framework == "django":
        print(
            "Then: add datasets.py and analytics.py to your Django project and follow "
            "README.md for the settings and URL."
        )
    else:
        print(f"Then run: {cd_prefix(destination)}{RUN_COMMAND[framework]}")
