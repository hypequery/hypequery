"""Framework-free command-line parsing shared by both entry points."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from importlib.metadata import version


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="hypequery", description="Author and serve Python datasets."
    )
    parser.add_argument("--version", action="version", version=f"hypequery {version('hypequery')}")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create a Python dataset project")
    init.add_argument(
        "directory", nargs="?", default=".", help="destination (default: current directory)"
    )
    dev = commands.add_parser("dev", help="serve a local app (requires the fastapi extra)")
    dev.add_argument("app", nargs="?", default="app:app", help="import string (default: app:app)")
    dev.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    dev.add_argument("--port", type=int, default=8000, help="port (default: 8000)")
    reload_options = dev.add_mutually_exclusive_group()
    reload_options.add_argument(
        "--reload", dest="reload", action="store_true", help="enable reload (default)"
    )
    reload_options.add_argument(
        "--no-reload", dest="reload", action="store_false", help="disable reload"
    )
    dev.set_defaults(reload=True)
    args = parser.parse_args(argv)
    if args.command == "dev" and not 0 < args.port < 65536:
        parser.error("--port must be between 1 and 65535")
    return args
