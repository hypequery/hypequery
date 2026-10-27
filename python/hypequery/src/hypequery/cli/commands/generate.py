"""Regenerate Python datasets from the same metadata used by init."""

from __future__ import annotations

import sys
from difflib import unified_diff
from pathlib import Path

from ..errors import CliError
from ..generators.datasets import generate_datasets, is_identifier
from ..generators.schema import discover_schema
from ..options import GenerateDatasetsOptions
from ..utils.display_path import display_path
from ..utils.generated_file import GeneratedFile
from ..utils.recorded_selection import recorded_selection
from ..utils.tenant_settings import configures_tenant


def run(options: GenerateDatasetsOptions) -> None:
    # init places datasets.py beside app.py, so default to the current directory.
    output = GeneratedFile(
        Path(options.output) if options.output else Path(options.path or ".") / "datasets.py"
    )
    if options.tenant_column is not None and not is_identifier(options.tenant_column):
        # Refuse before connecting, as with an unsafe output path.
        raise CliError("The tenant column is outside the SDK's supported identifier grammar.")
    current = output.read()
    tables, exclude_tables = options.tables, options.exclude_tables
    if tables is None and exclude_tables is None and not options.all_tables:
        # The project's schema.json sits beside the default datasets.py; with
        # --output elsewhere, the project is the directory the command runs in.
        recorded = recorded_selection(output.path.parent) or recorded_selection(Path.cwd())
        if recorded is not None:
            tables, exclude_tables = recorded.tables, recorded.exclude_tables
            described = ", ".join(
                f"{flag} {value}"
                for flag, value in (("--tables", tables), ("--exclude-tables", exclude_tables))
                if value
            )
            print(
                f"Using the table selection init recorded in schema.json ({described}); "
                "pass --tables, --exclude-tables or --all-tables to change it."
            )
    schema = discover_schema(tables=tables, exclude_tables=exclude_tables)
    generated = generate_datasets(schema, tenant_column=options.tenant_column)
    # Up-to-date, --diff and --check results must describe the file as it is now.
    output.ensure_unchanged()
    count = len(generated.tables)
    print(f"Generated dataset definitions for {count} {'table' if count == 1 else 'tables'}")
    for warning in generated.warnings:
        print(f"Review: {warning}")
    if current == generated.source:
        print(f"Dataset definitions are up to date: {display_path(output.path)}")
        return
    if options.diff:
        print(
            "".join(
                unified_diff(
                    (current or "").splitlines(keepends=True),
                    generated.source.splitlines(keepends=True),
                    fromfile=str(output.path),
                    tofile=f"{output.path} (generated)",
                )
            ),
            end="",
        )
        raise CliError("Generated dataset definitions differ.")
    if options.check:
        raise CliError("Dataset definitions are missing or out of date; inspect with --diff.")
    if current is not None and not options.force:
        raise CliError("Refusing to overwrite existing definitions; use --diff or --force.")
    output.write(generated.source, overwrite=options.force)
    print(
        f"{'Created' if current is None else 'Updated'} dataset definitions: "
        f"{display_path(output.path)}"
    )
    if (
        current is not None
        and configures_tenant(current)
        and not configures_tenant(generated.source)
    ):
        # --force is the author's decision; make the dropped boundary visible.
        print(
            "Warning: the replaced definitions configured tenant_key; generated "
            "definitions do not. Re-add tenant boundaries, or regenerate with "
            "--tenant-column, before serving.",
            file=sys.stderr,
        )
    print("Review suggested measures and access policy before serving these datasets.")
