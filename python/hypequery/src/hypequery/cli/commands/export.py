"""Offline canonical client artifact export; no implicit app or driver startup."""

from __future__ import annotations

import sys
from pathlib import Path

from ..errors import CliError
from ..options import ExportClientContractOptions
from ..utils.client_contract_factory import load_client_contract_factory
from ..utils.display_path import display_path
from ..utils.generated_file import GeneratedFile


def run(options: ExportClientContractOptions) -> None:
    if options.stdout:
        sys.stdout.write(load_client_contract_factory(options.factory))
        return
    output = GeneratedFile(
        Path(options.output or "client-contract.json"),
        max_bytes=1_048_576,
        overwrite_hint="--check or --force",
    )
    current = output.read()
    canonical = load_client_contract_factory(options.factory)
    output.ensure_unchanged()
    if current == canonical:
        print(f"Client contract is up to date: {display_path(output.path)}")
        return
    if options.check:
        raise CliError(
            "Client contract is missing or out of date; review it with --stdout, then rerun export "
            "with --force to replace it."
        )
    if current is not None and not options.force:
        raise CliError("Refusing to overwrite an existing client contract; use --check or --force.")
    output.write(canonical, overwrite=options.force)
    verb = "Created" if current is None else "Updated"
    print(f"{verb} client contract: {display_path(output.path)}")
