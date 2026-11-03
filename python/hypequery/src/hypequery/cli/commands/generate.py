"""Regenerate Python datasets from the same metadata used by init."""

from __future__ import annotations

import os
import sys
from difflib import unified_diff
from pathlib import Path

from ..errors import CliError
from ..generators.chdb_project import DEFAULT_CHDB_PATH
from ..generators.datasets import generate_datasets, is_identifier
from ..generators.schema import discover_schema
from ..options import GenerateDatasetsOptions
from ..utils.display_path import display_path
from ..utils.generated_file import GeneratedFile
from ..utils.project_config import recorded_chdb_path
from ..utils.recorded_selection import recorded_selection, recorded_tenant_column
from ..utils.tenant_settings import configures_tenant


def run(options: GenerateDatasetsOptions) -> None:
    # init places datasets.py beside app.py, so default to the current directory.
    output = GeneratedFile(
        Path(options.output) if options.output else Path(options.path or ".") / "datasets.py"
    )
    current = output.read()
    tables, exclude_tables = options.tables, options.exclude_tables
    tenant_column = options.tenant_column
    # The project's schema.json sits beside the default datasets.py. Only when
    # the output directory has none (--output elsewhere) is the project the
    # directory the command runs in. A target snapshot with no selection means
    # every table, and must not inherit another project's.
    project = output.path.parent
    if not (project / "schema.json").exists():
        project = Path.cwd()
    if tables is None and exclude_tables is None and not options.all_tables:
        recorded = recorded_selection(project)
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
    if tenant_column is None and not options.no_tenant_column:
        tenant_column = recorded_tenant_column(project)
        if tenant_column is not None:
            print(
                f"Using the tenant column init recorded in schema.json "
                f"(--tenant-column {tenant_column}); pass --tenant-column or "
                "--no-tenant-column to change it."
            )
    if tenant_column is not None and not is_identifier(tenant_column):
        # Refuse before connecting, as with an unsafe output path.
        raise CliError("The tenant column is outside the SDK's supported identifier grammar.")
    schema = discover_schema(
        tables=tables, exclude_tables=exclude_tables, chdb_path=_chdb_path(options, output.path)
    )
    generated = generate_datasets(schema, tenant_column=tenant_column)
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


def _chdb_path(options: GenerateDatasetsOptions, output: Path) -> Path | None:
    """The chDB database to read, or ``None`` for the ClickHouse server.

    An explicit ``--chdb-path`` is relative to the current directory. A path
    pyproject.toml records is relative to that project: the output's
    directory when it has one, else the current directory.
    """

    if options.database == "clickhouse":
        return None
    if options.chdb_path is not None:
        return Path(options.chdb_path)
    project = output.parent if (output.parent / "pyproject.toml").exists() else Path.cwd()
    recorded = recorded_chdb_path(project)
    if recorded is not None:
        print(
            f"Using the chDB database init recorded in pyproject.toml ({recorded}); "
            "pass --chdb-path or --database clickhouse to change it."
        )
        return project / recorded
    default = project / DEFAULT_CHDB_PATH
    if options.database == "chdb":
        return default
    # As in the TypeScript CLI, configured ClickHouse settings win over a local database.
    if default.is_dir() and not (
        os.environ.get("CLICKHOUSE_URL") or os.environ.get("CLICKHOUSE_HOST")
    ):
        print(
            f"Using the chDB database at {display_path(default)}; set CLICKHOUSE_URL or "
            "pass --database clickhouse to read a ClickHouse server instead."
        )
        return default
    return None
