"""Python CLI. Optional serving dependencies load only when a command runs."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from importlib import import_module
from typing import Any, Protocol, cast

from .errors import CliError
from .options import command_options
from .parser import parse_args
from .telemetry import CommandTelemetry, activate
from .telemetry.lifecycle import error_code
from .utils.env_files import env_root, load_env_files


class _Command(Protocol):
    def run(self, options: Any) -> None: ...


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch a command; argparse owns help and usage-error exit codes."""

    raw = list(sys.argv[1:] if argv is None else argv)
    # Like the TypeScript CLI: the launch directory's .env files fill in unset
    # variables (the project's, for `mcp --project`), before telemetry so an
    # opt-out set there is honored.
    load_env_files(env_root(raw))
    telemetry = CommandTelemetry(raw, flag_disabled="--no-telemetry" in raw)
    telemetry.begin()
    activate(telemetry)
    try:
        args = parse_args(raw)
    except SystemExit as exc:
        ok = exc.code in (None, 0)
        telemetry.finish("success" if ok else "failure", None if ok else "usage_error")
        raise
    try:
        command = cast(_Command, import_module(f"hypequery.cli.commands.{args.command}"))
        command.run(command_options(args))
    except CliError as exc:
        print(f"hypequery: {exc}", file=sys.stderr)
        telemetry.finish("failure", error_code(exc))
        return 1
    except KeyboardInterrupt:
        telemetry.finish("interrupted")
        return 0
    except SystemExit as exc:
        ok = exc.code in (None, 0)
        telemetry.finish("success" if ok else "failure", None if ok else "command_error")
        raise
    except BaseException as exc:
        telemetry.finish("failure", error_code(exc))
        raise
    telemetry.finish("success")
    return 0


__all__ = ["load_env_files", "main"]
