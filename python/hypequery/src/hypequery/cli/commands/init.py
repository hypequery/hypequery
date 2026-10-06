"""Create a Python dataset project without network calls or database writes."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import cast

from ..scaffold import Scaffold
from ..utils.templates import load_templates


def run(args: object) -> None:
    options = cast(argparse.Namespace, args)
    scaffold = Scaffold(Path(options.directory))
    if options.skip_connection:
        destination = scaffold.create()
        print("Created an offline orders example; no database schema was inspected.")
    else:
        from ..generators.datasets import generate_datasets
        from ..generators.project import schema_templates
        from ..generators.schema import discover_schema

        # Refuse collisions before making a database connection.
        scaffold.preflight(
            [
                "app.py",
                "datasets.py",
                "schema.json",
                "pyproject.toml",
                ".env.example",
                ".gitignore",
                "README.md",
            ]
        )
        schema = discover_schema(tables=options.tables, exclude_tables=options.exclude_tables)
        generated = generate_datasets(schema)
        destination = scaffold.create(schema_templates(load_templates(), schema, generated))
        print(f"Inspected {schema.database}: generated {len(generated.tables)} datasets.")
        for warning in generated.warnings:
            print(f"Review: {warning}")
    print(f"Created Python dataset project in {destination}")
    print(
        "Next: follow README.md to install dependencies, configure serving credentials "
        "and review dataset definitions."
    )
    print("Then run: hypequery dev")
