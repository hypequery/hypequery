"""Framework-free command-line parsing shared by both entry points."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from importlib.metadata import version


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="hypequery", description="Author and serve Python datasets."
    )
    parser.add_argument(
        "-V", "--version", action="version", version=f"hypequery {version('hypequery')}"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create a Python dataset project")
    init.add_argument("directory", nargs="?", help="destination (default: current directory)")
    init.add_argument("--path", help="destination directory (alias for the positional directory)")
    init.add_argument("--tables", help="comma-separated tables to inspect (default: all)")
    init.add_argument("--exclude-tables", help="comma-separated tables to omit")
    init.add_argument("--all-tables", action="store_true", help="inspect all tables (default)")
    init.add_argument(
        "--skip-connection",
        action="store_true",
        help="explicit offline example; no schema discovery",
    )
    dev = commands.add_parser("dev", help="serve a local app (requires the fastapi extra)")
    dev.add_argument("app", nargs="?", default="app:app", help="import string (default: app:app)")
    dev.add_argument(
        "--hostname",
        "--host",
        dest="host",
        default="127.0.0.1",
        help="bind address (default: 127.0.0.1)",
    )
    dev.add_argument("-p", "--port", type=int, default=8000, help="port (default: 8000)")
    reload_options = dev.add_mutually_exclusive_group()
    reload_options.add_argument(
        "--reload", dest="reload", action="store_true", help="enable reload (default)"
    )
    reload_options.add_argument(
        "--no-watch", "--no-reload", dest="reload", action="store_false", help="disable reload"
    )
    dev.set_defaults(reload=True)
    help_command = commands.add_parser("help", help="show help for a command")
    help_command.add_argument("topic", nargs="?", choices=("init", "dev"))
    args = parser.parse_args(argv)
    if args.command == "help":
        {None: parser, "init": init, "dev": dev}[args.topic].print_help()
        parser.exit()
    if args.command == "init":
        if args.directory is not None and args.path is not None:
            parser.error("use either --path or a positional directory")
        args.directory = args.path if args.path is not None else args.directory or "."
        if args.all_tables and args.tables:
            parser.error("--all-tables cannot be combined with --tables")
        if args.skip_connection and (args.tables or args.exclude_tables or args.all_tables):
            parser.error("table selection requires a database connection")
    if args.command == "dev" and not 0 < args.port < 65536:
        parser.error("--port must be between 1 and 65535")
    return args
