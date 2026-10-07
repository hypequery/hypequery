"""Regenerate Python datasets from the same metadata used by init."""

from __future__ import annotations

import argparse
import sys
from difflib import unified_diff
from pathlib import Path
from typing import cast

from ..errors import CliError
from ..generators.datasets import generate_datasets
from ..generators.schema import discover_schema
from ..utils.generated_file import GeneratedFile
from ..utils.tenant_settings import configures_tenant


def run(args: object) -> None:
    options = cast(argparse.Namespace, args)
    # init places datasets.py beside app.py, so default to the current directory.
    output = GeneratedFile(
        Path(options.output) if options.output else Path(options.path or ".") / "datasets.py"
    )
    current = output.read()
    schema = discover_schema(tables=options.tables, exclude_tables=options.exclude_tables)
    generated = generate_datasets(schema)
    # Up-to-date, --diff and --check results must describe the file as it is now.
    output.ensure_unchanged()
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
    if current is not None and not options.force:
        raise CliError("Refusing to overwrite existing definitions; use --diff or --force.")
    output.write(generated.source, overwrite=options.force)
    print(f"{'Created' if current is None else 'Updated'} dataset definitions: {output.path}")
    if current is not None and configures_tenant(current):
        # --force is the author's decision; make the dropped boundary visible.
        print(
            "Warning: the replaced definitions configured tenant_key; generated "
            "definitions do not. Re-add tenant boundaries before serving.",
            file=sys.stderr,
        )
    print("Review suggested measures and access policy before serving these datasets.")
