"""Framework-free command-line parsing shared by both entry points."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from importlib.metadata import version

from .generators.framework_apps import FRAMEWORKS


def _add_database_options(command: argparse.ArgumentParser, path_default: str) -> None:
    command.add_argument(
        "--database",
        choices=("clickhouse", "chdb"),
        help="a ClickHouse server (default), or chdb: embedded ClickHouse, no server "
        '(requires "hypequery[chdb]")',
    )
    command.add_argument(
        "--chdb-path",
        help=f"the chDB database directory, implying --database chdb; {path_default}",
    )


def _check_database_options(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    """``--chdb-path`` names an embedded database, so it implies ``--database chdb``."""

    if args.chdb_path is None:
        return
    if args.database == "clickhouse":
        parser.error("--chdb-path needs --database chdb")
    args.database = "chdb"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="hypequery",
        description="Author and serve Python datasets.",
        # No abbreviations: `--no-tel` must not pass as the opt-out below, which
        # is matched by its full name before parsing.
        allow_abbrev=False,
    )
    parser.add_argument(
        "-V", "--version", action="version", version=f"hypequery {version('hypequery')}"
    )
    parser.add_argument(
        "--no-telemetry",
        action="store_true",
        help="disable anonymous usage telemetry for this invocation (accepted anywhere)",
    )
    arguments = list(sys.argv[1:] if argv is None else argv)
    # Like the TypeScript CLI, the global opt-out is accepted anywhere on the line.
    no_telemetry = "--no-telemetry" in arguments
    arguments = [argument for argument in arguments if argument != "--no-telemetry"]
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
        help="application to scaffold beside datasets.py: a standalone ASGI app served by "
        "hypequery dev, a FastAPI app mounting it, or a Django or Flask app serving "
        "hypequery's endpoints natively (default: standalone)",
    )
    init.add_argument(
        "--tenant-column",
        help="set tenant_key to this column on tables that have it "
        "(requires a trusted runtime tenant scope)",
    )
    _add_database_options(init, "relative to the project directory (default: analytics.chdb)")
    init.add_argument(
        "--skip-connection",
        action="store_true",
        help="explicit offline example; no schema discovery",
    )
    init.add_argument(
        "--no-interactive",
        action="store_true",
        help="never ask questions, even in a terminal; unset options take their defaults "
        "(also when CI is set or input is not a terminal)",
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
    _add_database_options(
        datasets, "(default: the path init recorded in pyproject.toml, else analytics.chdb)"
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
        "--factory",
        required=True,
        help="module:attribute naming your API, or a zero-argument factory returning it "
        "or a contract",
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
    mcp = _add_mcp(commands)
    skill = _add_skill(commands)
    demo = _add_demo(commands)
    telemetry = commands.add_parser(
        "telemetry", help="show or change anonymous usage telemetry settings"
    )
    telemetry.add_argument(
        "action", nargs="?", default="status", choices=("status", "enable", "disable")
    )
    help_command = commands.add_parser("help", help="show help for a command")
    help_command.add_argument(
        "topic",
        nargs="?",
        choices=("init", "dev", "generate", "export", "mcp", "skill", "demo", "telemetry"),
    )
    args = parser.parse_args(arguments)
    args.no_telemetry = no_telemetry
    if args.command == "help":
        topics: dict[str | None, argparse.ArgumentParser] = {
            None: parser,
            "init": init,
            "dev": dev,
            "generate": generate,
            "export": export,
            "mcp": mcp,
            "skill": skill,
            "demo": demo,
            "telemetry": telemetry,
        }
        topics[args.topic].print_help()
        parser.exit()
    if args.command == "init":
        if args.directory is not None and args.path is not None:
            parser.error("use either --path or a positional directory")
        # None means "not given": guided init asks, and otherwise it is the current directory.
        args.directory = args.path if args.path is not None else args.directory
        if args.all_tables and args.tables:
            parser.error("--all-tables cannot be combined with --tables")
        if args.skip_connection and (
            args.tables or args.exclude_tables or args.all_tables or args.tenant_column
        ):
            parser.error("table selection and --tenant-column require a database connection")
    if args.command in ("init", "generate"):
        _check_database_options(parser, args)
    if args.command == "generate" and args.force and (args.check or args.diff):
        parser.error("--force cannot be combined with --check or --diff")
    if args.command == "generate" and args.all_tables and (args.tables or args.exclude_tables):
        parser.error("--all-tables cannot be combined with --tables or --exclude-tables")
    if args.command == "export":
        if args.check and args.force:
            parser.error("--force cannot be combined with --check")
        if (args.stdout or args.output == "-") and (args.check or args.force):
            parser.error("stdout export cannot be combined with --check or --force")
    validate = _COMMAND_VALIDATORS.get(args.command)
    if validate is not None:
        validate(parser, args)
    if args.command == "dev" and not 0 < args.port < 65536:
        parser.error("--port must be between 1 and 65535")
    return args


def _add_mcp(
    commands: argparse._SubParsersAction[argparse.ArgumentParser],
) -> argparse.ArgumentParser:
    mcp = commands.add_parser(
        "mcp",
        help="serve an API's datasets to AI agents over MCP stdio (requires the mcp extra)",
        description="Serve the four hypequery MCP tools over stdio, from an Api in this "
        "process (module:attribute) or from a served API's client contract "
        "(--client-contract-url). The API authenticates and scopes every call; "
        "HYPEQUERY_API_KEY, when set, is sent as a bearer token.",
    )
    mcp.add_argument(
        "app",
        nargs="?",
        help="the Api to serve, as module:attribute (default: app:api); "
        "an ASGI app from to_asgi_app also works",
    )
    mcp.add_argument(
        "--client-contract-url",
        help="bridge to a served API's authorized client contract instead "
        "(HTTPS; plain HTTP only on loopback)",
    )
    mcp.add_argument(
        "--header",
        action="append",
        default=[],
        metavar="NAME: VALUE",
        help="a request header for every call, such as a credential (repeatable)",
    )
    mcp.add_argument("--project", help="directory to import the app from (default: current)")
    mcp.add_argument(
        "--self-test",
        action="store_true",
        help="connect, list the tools and exit, without serving",
    )
    mcp.add_argument(
        "--print-config",
        action="store_true",
        help="print an mcpServers entry for Claude, Cursor or another MCP client and exit",
    )
    return mcp


def _add_demo(
    commands: argparse._SubParsersAction[argparse.ArgumentParser],
) -> argparse.ArgumentParser:
    demo = commands.add_parser(
        "demo",
        help="try a sample semantic layer on embedded ClickHouse, served over MCP stdio "
        "(requires the chdb and mcp extras)",
        description="Create a sample shop database on embedded ClickHouse (chDB) in a "
        "temporary directory and serve its datasets to an AI agent over MCP stdio. "
        "No server, no configuration and no network; the database is deleted on exit.",
    )
    demo.add_argument(
        "--tenant",
        # hypequery.cli.demo.api.TENANTS, kept literal so parsing imports nothing.
        choices=("acme", "globex"),
        default="acme",
        help="the tenant the agent is signed in as (default: acme)",
    )
    mode = demo.add_mutually_exclusive_group()
    mode.add_argument(
        "--self-test",
        action="store_true",
        help="answer the demo's questions in the terminal and exit, without serving "
        "(needs only the chdb extra)",
    )
    mode.add_argument(
        "--print-config",
        action="store_true",
        help="print an mcpServers entry for Claude Code, Cursor or another MCP client and exit",
    )
    return demo


def _validate_mcp(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.app is not None and args.client_contract_url is not None:
        parser.error("use either an app or --client-contract-url")
    if args.self_test and args.print_config:
        parser.error("--self-test cannot be combined with --print-config")


def _add_skill(
    commands: argparse._SubParsersAction[argparse.ArgumentParser],
) -> argparse.ArgumentParser:
    skill = commands.add_parser(
        "skill",
        help="install hypequery agent skills for Claude Code, Cursor and Codex",
        description="Write hypequery's agent skills (authoring datasets, querying them) "
        "where coding agents load them: .claude/skills for Claude Code, .agents/skills "
        "for Cursor and Codex.",
    )
    skill.add_argument("action", choices=("install",))
    skill.add_argument(
        "--agent",
        choices=("claude", "cursor", "codex", "all"),
        default="all",
        help="which agent to install for (default: all)",
    )
    skill.add_argument(
        "--scope",
        choices=("project", "user"),
        default="project",
        help="this project (default) or your home directory, for every project",
    )
    skill.add_argument(
        "--force", action="store_true", help="replace skills that were edited or are out of date"
    )
    skill.add_argument(
        "--check", action="store_true", help="exit 1 if a skill is missing or out of date"
    )
    return skill


def _validate_skill(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.check and args.force:
        parser.error("--force cannot be combined with --check")


#: Cross-option checks argparse cannot express, per command.
_COMMAND_VALIDATORS: dict[str, Callable[[argparse.ArgumentParser, argparse.Namespace], None]] = {
    "mcp": _validate_mcp,
    "skill": _validate_skill,
}
