"""Framework-free command-line parsing shared by both entry points."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from importlib.metadata import version

from .generators.framework_apps import FRAMEWORKS


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="hypequery", description="Author and serve Python datasets."
    )
    parser.add_argument(
        "-V", "--version", action="version", version=f"hypequery {version('hypequery')}"
    )
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments[:1] == ["generate:datasets"]:
        # Accept the TypeScript CLI's spelling as an alias.
        arguments[:1] = ["generate", "datasets"]
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create a Python dataset project")
    init.add_argument("directory", nargs="?", help="destination (default: current directory)")
    init.add_argument("--path", help="destination directory (alias for the positional directory)")
    init.add_argument("--tables", help="comma-separated tables to inspect (default: all)")
    init.add_argument("--exclude-tables", help="comma-separated tables to omit")
    init.add_argument("--all-tables", action="store_true", help="inspect all tables (default)")
    init.add_argument(
        "--framework",
        choices=FRAMEWORKS,
        default="standalone",
        help="application to scaffold beside datasets.py: a standalone ASGI app served by "
        "hypequery dev, or a Django or Flask app serving hypequery's endpoints natively "
        "(default: standalone)",
    )
    init.add_argument(
        "--tenant-column",
        help="set tenant_key to this column on tables that have it "
        "(requires a trusted runtime tenant scope)",
    )
    init.add_argument(
        "--skip-connection",
        action="store_true",
        help="explicit offline example; no schema discovery",
    )
    generate = commands.add_parser("generate", help="generate Python definitions from ClickHouse")
    targets = generate.add_subparsers(dest="target", required=True)
    datasets = targets.add_parser(
        "datasets",
        help="generate dataset definitions",
        description="Generate dataset definitions. Also available as generate:datasets.",
    )
    destination = datasets.add_mutually_exclusive_group()
    destination.add_argument("--output", help="output file (default: datasets.py, as init creates)")
    destination.add_argument("--path", help="output directory containing datasets.py")
    datasets.add_argument(
        "--tables",
        help="comma-separated tables to inspect "
        "(default: the selection recorded in schema.json, else all)",
    )
    datasets.add_argument("--exclude-tables", help="comma-separated tables to omit")
    datasets.add_argument(
        "--all-tables",
        action="store_true",
        help="inspect every table, ignoring the selection recorded in schema.json",
    )
    tenant = datasets.add_mutually_exclusive_group()
    tenant.add_argument(
        "--tenant-column",
        help="set tenant_key to this column on tables that have it "
        "(default: the column recorded in schema.json; requires a trusted runtime tenant scope)",
    )
    tenant.add_argument(
        "--no-tenant-column",
        action="store_true",
        help="set no tenant_key, ignoring the tenant column recorded in schema.json",
    )
    datasets.add_argument("--check", action="store_true", help="exit 1 on drift without writing")
    datasets.add_argument("--diff", action="store_true", help="show drift without writing; exit 1")
    datasets.add_argument("--force", action="store_true", help="replace existing definitions")
    export = commands.add_parser("export", help="export public client artifacts offline")
    export_targets = export.add_subparsers(dest="target", required=True)
    client_contract = export_targets.add_parser(
        "client-contract", help="export a signed client contract"
    )
    client_contract.add_argument(
        "--factory", required=True, help="explicit zero-argument definition factory: module:factory"
    )
    output = client_contract.add_mutually_exclusive_group()
    output.add_argument(
        "--output", help="output file (default: client-contract.json; - for stdout)"
    )
    output.add_argument("--stdout", action="store_true", help="write canonical JSON only to stdout")
    client_contract.add_argument(
        "--check", action="store_true", help="exit 1 on drift without writing"
    )
    client_contract.add_argument(
        "--force", action="store_true", help="replace an existing artifact"
    )
    dev = commands.add_parser("dev", help="serve a local app (requires the server extra)")
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
    help_command.add_argument("topic", nargs="?", choices=("init", "dev", "generate", "export"))
    args = parser.parse_args(arguments)
    if args.command == "help":
        {None: parser, "init": init, "dev": dev, "generate": generate, "export": export}[
            args.topic
        ].print_help()
        parser.exit()
    if args.command == "init":
        if args.directory is not None and args.path is not None:
            parser.error("use either --path or a positional directory")
        args.directory = args.path if args.path is not None else args.directory or "."
        if args.all_tables and args.tables:
            parser.error("--all-tables cannot be combined with --tables")
        if args.skip_connection and (
            args.tables or args.exclude_tables or args.all_tables or args.tenant_column
        ):
            parser.error("table selection and --tenant-column require a database connection")
    if args.command == "generate" and args.force and (args.check or args.diff):
        parser.error("--force cannot be combined with --check or --diff")
    if args.command == "generate" and args.all_tables and (args.tables or args.exclude_tables):
        parser.error("--all-tables cannot be combined with --tables or --exclude-tables")
    if args.command == "export":
        if args.check and args.force:
            parser.error("--force cannot be combined with --check")
        if (args.stdout or args.output == "-") and (args.check or args.force):
            parser.error("stdout export cannot be combined with --check or --force")
    if args.command == "dev" and not 0 < args.port < 65536:
        parser.error("--port must be between 1 and 65535")
    return args
