"""Python CLI. Optional serving dependencies load only when a command runs."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from importlib import import_module
from typing import Any, Protocol, cast

from .errors import CliError
from .options import command_options
from .parser import parse_args


class _Command(Protocol):
    def run(self, options: Any) -> None: ...


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch a command; argparse owns help and usage-error exit codes."""
    args = parse_args(argv)
    try:
        command = cast(_Command, import_module(f"hypequery.cli.commands.{args.command}"))
        command.run(command_options(args))
    except CliError as exc:
        print(f"hypequery: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    return 0


__all__ = ["main"]
