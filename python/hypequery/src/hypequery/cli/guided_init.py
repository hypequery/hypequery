"""Guided ``hypequery init``: in a terminal, ask for whatever the flags left unset.

The questions follow the TypeScript CLI's order (where, connect, what, how)
with Python's choices: which tables, which column holds the tenant, and which
app to scaffold. Every flag answers its question, so ``hypequery init
--framework django`` never asks about the framework. Connection details typed
here are used in memory to read the schema and are never written to a file.
"""

from __future__ import annotations

import os
import shlex
import sys
from collections.abc import Mapping
from dataclasses import dataclass, replace
from importlib.util import find_spec
from pathlib import Path
from typing import TYPE_CHECKING, TextIO, cast
from urllib.parse import urlsplit

from .errors import CliError
from .generators.framework_apps import FRAMEWORKS, Framework, project_files
from .options import InitOptions
from .utils.prompts import Prompter, SetupCancelledError

if TYPE_CHECKING:
    from .generators.schema import CatalogOverview

#: Above this many tables, ask which to include; below it, include them all.
TABLE_QUESTION_THRESHOLD = 10

_FRAMEWORK_LABELS: dict[Framework, str] = {
    "standalone": "Standalone API, served by hypequery dev (no web framework)",
    "django": "Django: serve hypequery's endpoints from your Django project",
    "flask": "Flask: serve hypequery's endpoints from a Flask app",
}


@dataclass(frozen=True)
class TypedConnection:
    """Connection details typed in, minus the password, to repeat as .env lines."""

    host: str
    port: int | None
    secure: bool
    database: str
    username: str


@dataclass(frozen=True)
class GuidedInit:
    options: InitOptions
    #: Connection settings for discovery: the process environment, typed-in details, or
    #: ``None`` for the offline example.
    environ: Mapping[str, str] | None
    typed: TypedConnection | None


def can_guide(
    options: InitOptions,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    environ: Mapping[str, str] | None = None,
) -> bool:
    """Only in a terminal, never under CI, and not with ``--no-interactive``."""

    env = os.environ if environ is None else environ
    stdin = sys.stdin if stdin is None else stdin
    stdout = sys.stdout if stdout is None else stdout
    return options.interactive and not env.get("CI") and _isatty(stdin) and _isatty(stdout)


def guide(
    options: InitOptions,
    prompter: Prompter,
    *,
    cwd: Path,
    environ: Mapping[str, str],
) -> GuidedInit:
    """The options with every unanswered question asked; raises ``SetupCancelledError`` on quit."""

    say = prompter.say
    say("Let's set up your Python dataset project. Press Enter to accept the [default].")
    say()

    directory = options.directory
    if directory is None:
        directory = prompter.text(
            "Where should we create the project?", "." if _is_empty(cwd) else "analytics"
        )

    connection: Mapping[str, str] | None = None
    typed: TypedConnection | None = None
    catalog = None
    if not options.skip_connection:
        connection, typed, catalog = _connect(prompter, environ)

    tables = options.tables
    if (
        catalog is not None
        and tables is None
        and options.exclude_tables is None
        and not options.all_tables
    ):
        tables = _ask_tables(prompter, catalog.database, catalog.tables)

    tenant_column = options.tenant_column
    if catalog is not None and tenant_column is None:
        tenant_column = _ask_tenant(prompter, catalog.tenant_columns, tables)

    framework = options.framework
    if framework is None:
        framework = _ask_framework(prompter, cwd)

    offline = catalog is None
    directory = _free_directory(
        prompter, cwd, directory, framework, offline=offline, asked=options.directory is None
    )

    result = replace(
        options,
        directory=directory,
        framework=framework,
        skip_connection=offline,
        tables=tables,
        tenant_column=tenant_column,
    )
    _summarise(prompter, result, catalog, typed)
    if not prompter.confirm("Create the project?", True):
        raise SetupCancelledError
    return GuidedInit(result, connection, typed)


def env_lines(typed: TypedConnection) -> list[str]:
    """The .env lines for a typed-in connection, with the password left for the user."""

    lines = [f"CLICKHOUSE_HOST={typed.host}"]
    if typed.port is not None:
        lines.append(f"CLICKHOUSE_PORT={typed.port}")
    lines += [
        f"CLICKHOUSE_SECURE={'true' if typed.secure else 'false'}",
        f"CLICKHOUSE_DATABASE={typed.database}",
        f"CLICKHOUSE_USERNAME={typed.username}",
        "CLICKHOUSE_PASSWORD=<your password>",
    ]
    return lines


def equivalent_command(options: InitOptions) -> str:
    """The same choices as flags, to repeat without questions or in CI."""

    parts = ["hypequery", "init", options.directory or "."]
    if options.framework:
        parts += ["--framework", options.framework]
    if options.skip_connection:
        parts.append("--skip-connection")
    if options.tables:
        parts += ["--tables", options.tables]
    if options.exclude_tables:
        parts += ["--exclude-tables", options.exclude_tables]
    if options.tenant_column:
        parts += ["--tenant-column", options.tenant_column]
    return " ".join(shlex.quote(part) for part in parts)


def _connect(
    prompter: Prompter, environ: Mapping[str, str]
) -> tuple[Mapping[str, str] | None, TypedConnection | None, CatalogOverview | None]:
    """Settings that reach ClickHouse, with its catalog; all ``None`` for the offline example."""

    from .generators.datasets import TENANT_HINTS
    from .generators.schema import discover_catalog

    say = prompter.say
    if find_spec("clickhouse_connect") is None:
        say('Reading your schema needs the ClickHouse driver: pip install "hypequery[clickhouse]"')
        if prompter.confirm("Create the offline example project instead?", True):
            return None, None, None
        raise SetupCancelledError

    use_environment = bool(environ.get("CLICKHOUSE_URL") or environ.get("CLICKHOUSE_HOST"))
    candidate: Mapping[str, str] | None = None
    typed: TypedConnection | None = None
    while True:
        if candidate is None and use_environment:
            use_environment = False
            described = _describe(environ)
            if described is not None and prompter.confirm(
                f"Use the ClickHouse connection from your environment ({described})?", True
            ):
                candidate, typed = environ, None
        if candidate is None:
            typed_in = _ask_connection(prompter)
            if typed_in is None:
                return None, None, None
            candidate, typed = typed_in
        say("Connecting to ClickHouse...")
        try:
            catalog = discover_catalog(environ=candidate, tenant_hints=TENANT_HINTS)
        except CliError as exc:
            say(str(exc))
            action = prompter.choose(
                "What next?",
                [
                    ("retry", "Try again"),
                    ("edit", "Enter different connection details"),
                    ("offline", "Create the offline example instead"),
                    ("quit", "Quit"),
                ],
            )
            if action == "edit":
                candidate = None
            elif action == "offline":
                return None, None, None
            elif action == "quit":
                raise SetupCancelledError from None
            continue
        count = len(catalog.tables)
        say(f"Connected to {catalog.database}: {count} table{'s' if count != 1 else ''}.")
        say()
        return candidate, typed, catalog


def _ask_connection(
    prompter: Prompter,
) -> tuple[dict[str, str], TypedConnection] | None:
    from hypequery.execution.utils.connection_url import url_fields

    while True:
        url = prompter.text(
            "ClickHouse URL, e.g. http://localhost:8123 (Enter to create an offline example)"
        )
        if not url:
            return None
        try:
            fields = url_fields(url)
        except ValueError as exc:
            prompter.say(f"That URL can't be used: {exc}.")
            continue
        parts = urlsplit(url.strip())
        username = fields["username"] if parts.username else prompter.text("Username", "default")
        password = (
            fields["password"]
            if parts.password is not None
            else prompter.secret("Password (hidden; Enter for none)")
        )
        database = (
            fields["database"] if parts.path.strip("/") else prompter.text("Database", "default")
        )
        settings = {
            "CLICKHOUSE_HOST": fields["host"],
            "CLICKHOUSE_PORT": "" if fields["port"] is None else str(fields["port"]),
            "CLICKHOUSE_SECURE": "true" if fields["secure"] else "false",
            "CLICKHOUSE_DATABASE": database,
            "CLICKHOUSE_USERNAME": username,
            "CLICKHOUSE_PASSWORD": password,
        }
        typed = TypedConnection(
            fields["host"], fields["port"], fields["secure"], database, username
        )
        return settings, typed


def _describe(environ: Mapping[str, str]) -> str | None:
    """Host, port and database of the environment's connection, never the credentials."""

    from hypequery.execution.utils.connection_env import connection_fields

    try:
        fields = connection_fields(environ)
    except ValueError:
        return None
    port = f":{fields['port']}" if fields["port"] is not None else ""
    return f"{fields['host']}{port}, database {fields['database']}"


def _ask_tables(prompter: Prompter, database: str, names: tuple[str, ...]) -> str | None:
    """A comma-separated selection, or ``None`` for every table."""

    if len(names) <= TABLE_QUESTION_THRESHOLD:
        return None
    if prompter.confirm(f"{database} has {len(names)} tables. Include all of them?", True):
        return None
    for index, name in enumerate(names, start=1):
        prompter.say(f"  {index:>3}) {name}")
    known = set(names)
    while True:
        answer = prompter.text("Tables to include (numbers or names, comma-separated)")
        chosen: list[str] = []
        unknown: list[str] = []
        for token in (part.strip() for part in answer.split(",")):
            if not token:
                continue
            if token.isdigit() and 1 <= int(token) <= len(names):
                chosen.append(names[int(token) - 1])
            elif token in known:
                chosen.append(token)
            else:
                unknown.append(token)
        if unknown:
            prompter.say(f"Not a table here: {', '.join(unknown)}.")
            continue
        if not chosen:
            prompter.say("Choose at least one table, or press Ctrl-C to stop.")
            continue
        return ",".join(dict.fromkeys(chosen))


def _ask_tenant(
    prompter: Prompter, tenant_columns: Mapping[str, tuple[str, ...]], tables: str | None
) -> str | None:
    """The tenant column to scope datasets by, offered only when one looks likely."""

    from .generators.datasets import is_identifier

    selected = set(tables.split(",")) if tables else None
    counts = {
        column: [table for table in found if selected is None or table in selected]
        for column, found in tenant_columns.items()
    }
    counts = {column: found for column, found in counts.items() if found}
    if not counts:
        return None
    column = max(counts, key=lambda name: (len(counts[name]), name == "tenant_id"))
    found = len(counts[column])
    choice = prompter.choose(
        f"{column} on {found} table{'s' if found != 1 else ''} looks like a tenant id. "
        "Scope those datasets by it, so each query only sees one tenant's rows?",
        [
            ("yes", f"Yes, use {column}"),
            ("other", "Yes, but use a different column"),
            ("no", "No tenant isolation"),
        ],
    )
    if choice == "no":
        return None
    if choice == "yes":
        return column
    while True:
        other = prompter.text("Tenant column")
        if other and is_identifier(other):
            return other
        prompter.say("Enter a column name, such as account_id.")


def _ask_framework(prompter: Prompter, cwd: Path) -> Framework:
    detected = _detect_framework(cwd)
    if detected != "standalone":
        prompter.say(f"Found a {detected.capitalize()} project here.")
    return prompter.choose(
        "Which app should we scaffold beside your datasets?",
        [(framework, _FRAMEWORK_LABELS[framework]) for framework in FRAMEWORKS],
        default=FRAMEWORKS.index(detected),
    )


def _detect_framework(cwd: Path) -> Framework:
    if (cwd / "manage.py").exists():
        return "django"
    text = ""
    for name in ("pyproject.toml", "requirements.txt"):
        try:
            text += (cwd / name).read_text(encoding="utf-8").lower()
        except (OSError, UnicodeDecodeError):
            continue
    if "django" in text:
        return "django"
    if "flask" in text:
        return "flask"
    return "standalone"


def _free_directory(
    prompter: Prompter,
    cwd: Path,
    directory: str,
    framework: str,
    *,
    offline: bool,
    asked: bool,
) -> str:
    """A destination init can write to; re-asks only when the folder came from a question."""

    names = project_files(cast(Framework, framework), offline=offline)
    while asked:
        clashes = [name for name in names if (cwd / directory / name).exists()]
        if not clashes:
            break
        prompter.say(f"{directory} already has {', '.join(clashes)}.")
        directory = prompter.text("Where should we create the project instead?", "analytics")
    return directory


def _summarise(
    prompter: Prompter,
    options: InitOptions,
    catalog: CatalogOverview | None,
    typed: TypedConnection | None,
) -> None:
    say = prompter.say
    say()
    say("Ready to create:")
    say(f"  Folder:      {options.directory}")
    if catalog is None:
        say("  ClickHouse:  none yet (offline orders example)")
    else:
        say(f"  ClickHouse:  {catalog.database}" + (f" on {typed.host}" if typed else ""))
        say(f"  Tables:      {options.tables or 'all'}")
        say(f"  Tenant key:  {options.tenant_column or 'none'}")
    say(f"  App:         {_FRAMEWORK_LABELS[cast(Framework, options.framework)]}")
    say("The same, without questions:")
    say(f"  {equivalent_command(options)}")
    say()


def _is_empty(directory: Path) -> bool:
    try:
        return not any(entry for entry in directory.iterdir() if not entry.name.startswith("."))
    except OSError:
        return False


def _isatty(stream: TextIO) -> bool:
    try:
        return stream.isatty()
    except (AttributeError, ValueError):
        return False
