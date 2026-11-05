"""Python CLI. Optional serving dependencies load only when a command runs."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast

from .errors import CliError
from .options import command_options
from .parser import parse_args
from .utils.env_files import load_env_files


class _Command(Protocol):
    def run(self, options: Any) -> None: ...


def _env_root(args: Any) -> Path:
    project = getattr(args, "project", None) if args.command == "mcp" else None
    if project is not None and Path(project).is_dir():
        return Path(project).resolve()
    return Path.cwd()


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch a command; argparse owns help and usage-error exit codes."""
    args = parse_args(argv)
    # Like the TypeScript CLI: the launch directory's .env files fill in unset
    # variables. `mcp --project` reads the project's instead: an MCP client
    # launches it from anywhere, and the project's settings must win.
    load_env_files(_env_root(args))
    try:
        command = cast(_Command, import_module(f"hypequery.cli.commands.{args.command}"))
        command.run(command_options(args))
    except CliError as exc:
        print(f"hypequery: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    return 0


__all__ = ["load_env_files", "main"]
