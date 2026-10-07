"""Regenerate Python datasets from the same metadata used by init."""

from __future__ import annotations

import argparse
from difflib import unified_diff
from pathlib import Path
from typing import cast

from ..errors import CliError
from ..generators.datasets import generate_datasets
from ..generators.schema import discover_schema
from ..utils.generated_file import GeneratedFile, has_tenant_configuration


def run(args: object) -> None:
    options = cast(argparse.Namespace, args)
    output = GeneratedFile(
        Path(options.output)
        if options.output
        else Path(options.path or "analytics") / "datasets.py"
    )
    current = output.read()
    schema = discover_schema(tables=options.tables, exclude_tables=options.exclude_tables)
    generated = generate_datasets(schema)
    for warning in generated.warnings:
        print(f"Review: {warning}")
    if current == generated.source:
        print(f"Dataset definitions are up to date: {output.path}")
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
    if current is not None:
        if not options.force:
            raise CliError("Refusing to overwrite existing definitions; use --diff or --force.")
        if has_tenant_configuration(current):
            raise CliError(
                "Refusing to replace configured tenant boundaries. Generate to a separate "
                "file and merge schema changes while preserving tenant_key."
            )
    output.write(generated.source, overwrite=options.force)
    print(f"{'Created' if current is None else 'Updated'} dataset definitions: {output.path}")
    print("Review suggested measures and access policy before serving these datasets.")
