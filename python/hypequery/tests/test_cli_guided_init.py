"""Guided ``hypequery init`` and the CLI's ``.env`` loading.

Answers are scripted through ``Prompter``'s injectable readers; ClickHouse is
replaced by fakes of ``discover_catalog`` and ``discover_schema``.
"""

from __future__ import annotations

import io
import logging
import os
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from hypequery.cli import main
from hypequery.cli.commands import init as init_command
from hypequery.cli.errors import CliError, DatabaseOpenError
from hypequery.cli.generators import schema as schema_module
from hypequery.cli.generators.schema import (
    CatalogOverview,
    Column,
    ConnectionSummary,
    DiscoveryConnectionError,
    Schema,
    Table,
)
from hypequery.cli.guided_init import (
    GuidedInit,
    can_guide,
    env_lines,
    equivalent_command,
    guide,
)
from hypequery.cli.options import InitOptions
from hypequery.cli.telemetry import init_funnel
from hypequery.cli.telemetry.catalog import COMPLETED_EVENT, contract
from hypequery.cli.utils.env_files import load_env_files, parse_env
from hypequery.cli.utils.prompts import Prompter, SetupCancelledError

#: A typed-in password the tests check never reaches output or files.
PASSWORD = "s3cret"  # noqa: S105

SCHEMA = Schema(
    "analytics",
    (
        Table("orders", (Column("id", "UInt64"), Column("org_id", "String"))),
        Table("customers", (Column("id", "UInt64"), Column("org_id", "String"))),
        Table("lookups", (Column("code", "String"),)),
    ),
    ConnectionSummary("ch.example", 8123, False, from_url=False),
)
SMALL = CatalogOverview(
    "analytics",
    ("customers", "lookups", "orders"),
    {"org_id": ("customers", "orders")},
)
MANY = CatalogOverview(
    "warehouse",
    tuple(f"t{index:02d}" for index in range(1, 13)),
    {"tenant_id": ("t01", "t02", "t03")},
)


class Script:
    """Scripted answers; records every prompt shown, hidden or not."""

    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.prompts: list[str] = []
        self.secret_prompts: list[str] = []
        self.output = io.StringIO()

    def read(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if not self.answers:
            raise EOFError
        return self.answers.pop(0)

    def read_secret(self, prompt: str) -> str:
        self.secret_prompts.append(prompt)
        return self.read(prompt)

    def prompter(self) -> Prompter:
        return Prompter(self.read, self.read_secret, self.output)

    @property
    def text(self) -> str:
        return self.output.getvalue() + "\n".join(self.prompts)


def options(**overrides: Any) -> InitOptions:
    values: dict[str, Any] = {
        "directory": None,
        "tables": None,
        "exclude_tables": None,
        "tenant_column": None,
        "framework": None,
        "skip_connection": False,
    }
    values.update(overrides)
    return InitOptions(**values)


@pytest.fixture
def catalog(monkeypatch: pytest.MonkeyPatch) -> Callable[..., list[Mapping[str, str]]]:
    """Make ``discover_catalog`` answer with the given results (or raise them) in turn."""

    def install(*results: CatalogOverview | Exception) -> list[Mapping[str, str]]:
        queue = list(results)
        seen: list[Mapping[str, str]] = []

        def fake(*, environ: Mapping[str, str], tenant_hints: object = ()) -> CatalogOverview:
            seen.append(environ)
            result = queue.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        monkeypatch.setattr(schema_module, "discover_catalog", fake)
        return seen

    return install


def run_guide(
    script: Script,
    cwd: Path,
    *,
    environ: Mapping[str, str] | None = None,
    **overrides: Any,
) -> GuidedInit:
    return guide(options(**overrides), script.prompter(), cwd=cwd, environ=environ or {})


# --- .env loading ---------------------------------------------------------------------------


def test_parse_env_reads_dotenv_syntax() -> None:
    text = """
# a comment
export CLICKHOUSE_HOST=ch.example
CLICKHOUSE_PORT = 8123   # trailing comment
QUOTED="two words # not a comment"
SINGLE='$literal'
ESCAPED="line\\nbreak"
not an assignment
EMPTY=
"""
    assert dict(parse_env(text)) == {
        "CLICKHOUSE_HOST": "ch.example",
        "CLICKHOUSE_PORT": "8123",
        "QUOTED": "two words # not a comment",
        "SINGLE": "$literal",
        "ESCAPED": "line\nbreak",
        "EMPTY": "",
    }


def test_env_files_never_replace_set_variables(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("A=from-env\nB=from-env\nC=from-env\n")
    (tmp_path / ".env.local").write_text("B=from-local\n")
    environ = {"C": "real"}
    loaded = load_env_files(tmp_path, environ)
    assert environ == {"A": "from-env", "B": "from-local", "C": "real"}
    assert [path.name for path in loaded] == [".env.local", ".env"]


def test_missing_env_files_are_skipped(tmp_path: Path) -> None:
    environ: dict[str, str] = {}
    assert load_env_files(tmp_path, environ) == []
    assert environ == {}


def test_the_cli_loads_the_launch_directory_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("HQ_GUIDED_TEST_VALUE", raising=False)
    (tmp_path / ".env").write_text("HQ_GUIDED_TEST_VALUE=loaded\n")
    assert main(["init", "project", "--skip-connection", "--no-interactive"]) == 0
    assert os.environ["HQ_GUIDED_TEST_VALUE"] == "loaded"


# --- when guided mode runs ------------------------------------------------------------------


class _Terminal(io.StringIO):
    def isatty(self) -> bool:
        return True


def test_guides_only_in_a_terminal_without_ci() -> None:
    tty = _Terminal()
    assert can_guide(options(), tty, tty, {})
    assert not can_guide(options(), io.StringIO(), tty, {})
    assert not can_guide(options(), tty, io.StringIO(), {})
    assert not can_guide(options(), tty, tty, {"CI": "true"})
    assert not can_guide(options(interactive=False), tty, tty, {})


def test_without_a_terminal_init_asks_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_questions(*_: object, **__: object) -> None:
        raise AssertionError("init asked a question without a terminal")

    monkeypatch.setattr(init_command, "guide", no_questions)
    assert main(["init", str(tmp_path / "project"), "--skip-connection"]) == 0
    assert (tmp_path / "project" / "app.py").exists()


# --- the questions --------------------------------------------------------------------------


def test_offline_path_with_every_default(tmp_path: Path) -> None:
    script = Script("", "", "", "")  # folder, URL (offline), framework, create
    guided = run_guide(script, tmp_path)
    assert guided.options.directory == "."
    assert guided.options.skip_connection
    assert guided.options.framework == "standalone"
    assert guided.environ is None
    assert (
        "hypequery init . --no-interactive --framework standalone --skip-connection" in script.text
    )


def test_a_non_empty_folder_suggests_a_subfolder(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("")
    script = Script("", "", "", "")
    assert run_guide(script, tmp_path).options.directory == "analytics"


def test_uses_the_environment_connection(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    seen = catalog(SMALL)
    environ = {"CLICKHOUSE_HOST": "ch.example", "CLICKHOUSE_PASSWORD": "env-secret"}
    script = Script("", "", "", "3", "")  # folder, use env, tenant yes, django, create
    guided = run_guide(script, tmp_path, environ=environ)
    assert seen == [environ]
    assert guided.environ is environ
    assert guided.typed is None
    assert guided.options.tenant_column == "org_id"
    assert guided.options.framework == "django"
    assert guided.options.tables is None  # 3 tables: no table question
    assert "Use the ClickHouse connection from your environment (ch.example" in script.text
    assert "env-secret" not in script.text


def test_typed_in_connection_is_used_but_never_shown(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    seen = catalog(CatalogOverview("analytics", ("orders",), {}))
    script = Script("", "http://ch.example:8123", "alice", PASSWORD, "analytics", "", "")
    guided = run_guide(script, tmp_path)
    assert script.secret_prompts == ["Password (hidden; Enter for none): "]
    assert seen[0]["CLICKHOUSE_PASSWORD"] == PASSWORD
    assert seen[0]["CLICKHOUSE_USERNAME"] == "alice"
    assert seen[0]["CLICKHOUSE_DATABASE"] == "analytics"
    assert guided.typed is not None
    lines = env_lines(guided.typed)
    assert "CLICKHOUSE_HOST=ch.example" in lines
    assert "CLICKHOUSE_PASSWORD=<your password>" in lines
    assert PASSWORD not in script.output.getvalue()
    assert not any(PASSWORD in line for line in lines)


def test_url_credentials_are_not_asked_again(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    seen = catalog(CatalogOverview("sales", ("orders",), {}))
    script = Script("", "https://bob:pw@ch.example/sales", "", "")
    run_guide(script, tmp_path)
    assert script.secret_prompts == []
    assert seen[0]["CLICKHOUSE_USERNAME"] == "bob"
    assert seen[0]["CLICKHOUSE_DATABASE"] == "sales"
    assert seen[0]["CLICKHOUSE_SECURE"] == "true"


def test_an_invalid_url_is_asked_again(tmp_path: Path) -> None:
    script = Script("", "tcp://ch.example:9000", "", "", "")
    guided = run_guide(script, tmp_path)
    assert "That URL can't be used" in script.text
    assert guided.options.skip_connection


def test_a_failed_connection_offers_retry(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    catalog(DiscoveryConnectionError("Cannot inspect ClickHouse. unreachable"), SMALL)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    script = Script("", "", "1", "", "", "")  # folder, use env, retry, tenant, framework, create
    guided = run_guide(script, tmp_path, environ=environ)
    assert "Cannot inspect ClickHouse" in script.text
    assert not guided.options.skip_connection


def test_a_failed_connection_can_fall_back_to_offline(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    catalog(DiscoveryConnectionError("Cannot inspect ClickHouse. unreachable"))
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    script = Script("", "", "3", "", "")  # folder, use env, offline, framework, create
    assert run_guide(script, tmp_path, environ=environ).options.skip_connection


def test_many_tables_ask_which_to_include(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    catalog(MANY)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    # folder, use env, all tables? no, a bad pick, numbers and a name, tenant, framework, create
    script = Script("", "", "n", "nope", "1, 3,t03", "", "", "")
    guided = run_guide(script, tmp_path, environ=environ)
    assert "warehouse has 12 tables" in script.text
    assert "Not a table here: nope" in script.text
    assert guided.options.tables == "t01,t03"
    # The tenant question counts only the chosen tables.
    assert "tenant_id on 2 tables" in script.text
    assert guided.options.tenant_column == "tenant_id"


def test_tenant_isolation_can_be_declined_or_renamed(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    catalog(SMALL, SMALL)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    declined = run_guide(Script("", "", "3", "", ""), tmp_path, environ=environ)
    assert declined.options.tenant_column is None
    renamed = run_guide(Script("", "", "2", "account_id", "", ""), tmp_path, environ=environ)
    assert renamed.options.tenant_column == "account_id"


def test_flags_answer_their_questions(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    catalog(SMALL)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    script = Script("", "")  # use env, create
    guided = run_guide(
        script,
        tmp_path,
        environ=environ,
        directory=str(tmp_path / "out"),
        framework="flask",
        tenant_column="org_id",
    )
    asked = "\n".join(script.prompts)
    assert "Where should we create" not in asked
    assert "Which app" not in script.text
    assert "looks like a tenant id" not in script.text
    assert guided.options.framework == "flask"


@pytest.mark.parametrize(
    ("files", "expected"),
    [
        ({"manage.py": ""}, "django"),
        ({"pyproject.toml": 'dependencies = ["Flask>=3"]'}, "flask"),
        ({"requirements.txt": "django==5.2\n"}, "django"),
        ({"requirements.txt": "fastapi[standard]\nuvicorn\n"}, "fastapi"),
        ({}, "standalone"),
    ],
)
def test_the_framework_default_follows_the_project(
    tmp_path: Path, files: dict[str, str], expected: str
) -> None:
    for name, content in files.items():
        (tmp_path / name).write_text(content)
    script = Script("out", "", "", "")  # folder, offline, framework default, create
    assert run_guide(script, tmp_path).options.framework == expected
    if expected == "fastapi":
        assert "Found a FastAPI project here." in script.text


def test_a_folder_that_would_be_overwritten_is_asked_again(tmp_path: Path) -> None:
    taken = tmp_path / "taken"
    taken.mkdir()
    (taken / "app.py").write_text("")
    script = Script(str(taken), "", "", str(tmp_path / "fresh"), "")
    guided = run_guide(script, tmp_path)
    assert "already has app.py" in script.text
    assert guided.options.directory == str(tmp_path / "fresh")


def test_ending_input_cancels(tmp_path: Path) -> None:
    with pytest.raises(SetupCancelledError):
        run_guide(Script(""), tmp_path)


def test_declining_the_summary_cancels(tmp_path: Path) -> None:
    with pytest.raises(SetupCancelledError):
        run_guide(Script("", "", "", "n"), tmp_path)


def test_equivalent_command_quotes_its_values() -> None:
    command = equivalent_command(
        options(directory="my project", framework="django", tables="a,b", tenant_column="org_id")
    )
    assert command == (
        "hypequery init 'my project' --no-interactive --framework django --tables a,b "
        "--tenant-column org_id"
    )


# --- end to end through init --------------------------------------------------------------


def _guided_run(monkeypatch: pytest.MonkeyPatch, script: Script, cwd: Path) -> None:
    monkeypatch.chdir(cwd)
    monkeypatch.setattr(init_command, "can_guide", lambda _options: True)
    monkeypatch.setattr(init_command, "Prompter", script.prompter)
    for name in ("CLICKHOUSE_URL", "CLICKHOUSE_HOST"):
        monkeypatch.delenv(name, raising=False)


def test_guided_init_creates_the_project_and_explains_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    catalog: Callable[..., list[Mapping[str, str]]],
) -> None:
    catalog(SMALL)
    schema_calls: list[Mapping[str, str] | None] = []

    def fake_schema(**kwargs: Any) -> Schema:
        schema_calls.append(kwargs.get("environ"))
        return SCHEMA

    monkeypatch.setattr(schema_module, "discover_schema", fake_schema)
    script = Script("project", "http://ch.example:8123", "alice", PASSWORD, "", "", "", "")
    _guided_run(monkeypatch, script, tmp_path)
    assert main(["init"]) == 0
    out = capsys.readouterr().out
    assert (tmp_path / "project" / "datasets.py").exists()
    assert "tenant_key='org_id'" in (tmp_path / "project" / "datasets.py").read_text()
    assert schema_calls
    assert schema_calls[0] is not None
    assert schema_calls[0]["CLICKHOUSE_PASSWORD"] == PASSWORD
    assert "Add your connection to" in out
    assert "CLICKHOUSE_PASSWORD=<your password>" in out
    assert PASSWORD not in out
    for path in (tmp_path / "project").rglob("*"):
        if path.is_file():
            assert PASSWORD not in path.read_text(errors="replace"), path


def test_cancelling_creates_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _guided_run(monkeypatch, Script("project"), tmp_path)
    assert main(["init"]) == 0
    assert "Setup cancelled; nothing was created." in capsys.readouterr().out
    assert not (tmp_path / "project").exists()


# --- non-interactive failures and the driver's log noise -------------------------------------


def test_an_unreachable_database_suggests_skip_connection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def unreachable(**_: object) -> Schema:
        raise DiscoveryConnectionError("Cannot inspect ClickHouse. ClickHouse is unreachable.")

    monkeypatch.setattr(schema_module, "discover_schema", unreachable)
    assert main(["init", str(tmp_path / "project"), "--no-interactive"]) == 1
    assert "add --skip-connection" in capsys.readouterr().err


def test_other_discovery_errors_keep_their_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def missing(**_: object) -> Schema:
        raise CliError("Requested tables do not exist: nope")

    monkeypatch.setattr(schema_module, "discover_schema", missing)
    assert main(["init", str(tmp_path / "project"), "--no-interactive"]) == 1
    error = capsys.readouterr().err
    assert "Requested tables do not exist" in error
    assert "--skip-connection" not in error


def test_the_driver_log_lines_stay_off_the_terminal(capsys: pytest.CaptureFixture[str]) -> None:
    with schema_module._quiet_driver():
        logging.getLogger("clickhouse_connect.driver.httpclient").error(
            "Unexpected Http Driver Exception"
        )
    assert "Unexpected Http Driver Exception" not in capsys.readouterr().err
    assert logging.getLogger("clickhouse_connect").propagate


def test_discover_catalog_reads_tables_and_tenant_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Result:
        def __init__(self, rows: list[tuple[object, ...]]) -> None:
            self.result_rows = rows

    class Client:
        def query(
            self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
        ) -> Result:
            if "currentDatabase" in query:
                return Result([("analytics",)])
            if "system.tables" in query:
                return Result([("customers",), ("orders",)])
            assert "hints" not in parameters  # every column, matched in Python
            return Result(
                [
                    ("id", "customers"),
                    ("org_id", "customers"),
                    ("id", "orders"),
                    ("org_id", "orders"),
                ]
            )

        def close(self) -> None:
            pass

    @contextmanager
    def connected(_environ: Mapping[str, str]) -> Iterator[tuple[Client, dict[str, object]]]:
        yield Client(), {}

    monkeypatch.setattr(schema_module, "_connected", connected)
    monkeypatch.setattr(schema_module, "_catalog_settings", lambda _client: {})
    overview = schema_module.discover_catalog(environ={}, tenant_hints=("tenant_id", "org_id"))
    assert overview == CatalogOverview(
        "analytics",
        ("customers", "orders"),
        {"org_id": ("customers", "orders")},
        {"customers": ("id", "org_id"), "orders": ("id", "org_id")},
    )


def test_discover_catalog_with_too_many_columns_reads_only_the_hints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Result:
        def __init__(self, rows: list[tuple[object, ...]]) -> None:
            self.result_rows = rows

    queries: list[dict[str, object]] = []

    class Client:
        def query(
            self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
        ) -> Result:
            if "currentDatabase" in query:
                return Result([("analytics",)])
            if "system.tables" in query:
                return Result([("orders",)])
            queries.append(parameters)
            if "hints" in parameters:
                return Result([("org_id", "orders")])
            return Result([("id", "orders"), ("org_id", "orders"), ("amount", "orders")])

        def close(self) -> None:
            pass

    @contextmanager
    def connected(_environ: Mapping[str, str]) -> Iterator[tuple[Client, dict[str, object]]]:
        yield Client(), {}

    monkeypatch.setattr(schema_module, "_connected", connected)
    monkeypatch.setattr(schema_module, "_catalog_settings", lambda _client: {})
    monkeypatch.setattr(schema_module, "_ROW_CAP", 2)
    overview = schema_module.discover_catalog(environ={}, tenant_hints=("org_id",))
    assert [sorted(q) for q in queries] == [["database"], ["database", "hints"]]
    assert overview.tenant_columns == {"org_id": ("orders",)}
    assert overview.columns == {}  # unknown, so the typed-in column goes unchecked


# --- review fixes --------------------------------------------------------------------------


def test_quoted_env_values_drop_trailing_comments() -> None:
    text = """A="secret" # local
B='single quoted' # note
C="say \\"hi\\"" # escaped quotes
D="unclosed # stays as text up to the comment
"""
    assert dict(parse_env(text)) == {
        "A": "secret",
        "B": "single quoted",
        "C": 'say "hi"',
        "D": '"unclosed',
    }


def test_discover_catalog_keeps_the_column_spelling(monkeypatch: pytest.MonkeyPatch) -> None:
    class Result:
        def __init__(self, rows: list[tuple[object, ...]]) -> None:
            self.result_rows = rows

    seen: dict[str, object] = {}

    class Client:
        def query(
            self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
        ) -> Result:
            if "currentDatabase" in query:
                return Result([("analytics",)])
            if "system.tables" in query:
                return Result([("orders",)])
            seen.update(parameters)
            return Result([("id", "orders"), ("Org_ID", "orders")])

        def close(self) -> None:
            pass

    @contextmanager
    def connected(_environ: Mapping[str, str]) -> Iterator[tuple[Client, dict[str, object]]]:
        yield Client(), {}

    monkeypatch.setattr(schema_module, "_connected", connected)
    monkeypatch.setattr(schema_module, "_catalog_settings", lambda _client: {})
    overview = schema_module.discover_catalog(environ={}, tenant_hints=("ORG_ID",))
    assert seen == {"database": "analytics"}
    # The generator matches tenant_key on the exact name, so the suggestion keeps it.
    assert overview.tenant_columns == {"Org_ID": ("orders",)}


def test_the_tenant_question_follows_the_final_table_selection(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    only_on_excluded = CatalogOverview("analytics", ("events", "orders"), {"org_id": ("events",)})
    catalog(only_on_excluded, MANY)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    excluded = Script("", "", "", "")  # folder, use env, framework, create
    guided = run_guide(excluded, tmp_path, environ=environ, exclude_tables="events")
    assert "looks like a tenant id" not in excluded.text
    assert guided.options.tenant_column is None
    spaced = Script("", "", "", "", "")  # folder, use env, tenant, framework, create
    run_guide(spaced, tmp_path, environ=environ, tables="t01, t02")
    assert "tenant_id on 2 tables" in spaced.text


def test_the_seed_step_reads_env_files(tmp_path: Path) -> None:
    assert main(["init", str(tmp_path / "project"), "--skip-connection", "--no-interactive"]) == 0
    readme = (tmp_path / "project" / "README.md").read_text()
    assert "load_env_files(Path.cwd())" in readme
    assert ". ./.env" not in readme
    assert "ClickHouseConnection.from_env()" in readme
    assert 'os.environ["CLICKHOUSE_HOST"]' not in readme


def test_a_tie_suggests_the_stronger_tenant_name(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    tied = CatalogOverview(
        "analytics",
        ("customers", "orders"),
        {"customer_id": ("customers", "orders"), "org_id": ("customers", "orders")},
    )
    catalog(tied)
    script = Script("", "", "", "", "")  # folder, use env, tenant, framework, create
    guided = run_guide(script, tmp_path, environ={"CLICKHOUSE_HOST": "ch.example"})
    assert "org_id on 2 tables" in script.text
    assert guided.options.tenant_column == "org_id"


def test_the_folder_re_ask_never_defaults_to_the_clashing_one(tmp_path: Path) -> None:
    (tmp_path / "analytics").mkdir()
    (tmp_path / "analytics" / "datasets.py").write_text("")
    # folder (default analytics, taken), offline, framework, folder again (accept), create
    script = Script("", "", "", "", "")
    guided = run_guide(script, tmp_path)
    assert "Where should we create the project instead? [analytics-2]: " in script.prompts
    assert guided.options.directory == "analytics-2"


def test_a_typed_tenant_column_is_checked_against_the_selected_tables(
    tmp_path: Path, catalog: Callable[..., list[Mapping[str, str]]]
) -> None:
    known = CatalogOverview(
        SMALL.database,
        SMALL.tables,
        SMALL.tenant_columns,
        {"customers": ("id", "org_id"), "lookups": ("code",), "orders": ("id", "org_id")},
    )
    catalog(known, known)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    # Decline the warning once, then pick a real column.
    script = Script("", "", "2", "acount_id", "n", "org_id", "", "")
    guided = run_guide(script, tmp_path, environ=environ)
    assert "None of the selected tables has a column named acount_id" in script.text
    assert "Use acount_id anyway? [y/N]: " in script.prompts
    assert guided.options.tenant_column == "org_id"
    # Or insist, when the column is known to exist elsewhere.
    insisted = run_guide(Script("", "", "2", "acount_id", "y", "", ""), tmp_path, environ=environ)
    assert insisted.options.tenant_column == "acount_id"


# --- where init stops (telemetry) ------------------------------------------------------------


@pytest.fixture
def funnel_metrics(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """What ``InitFunnel`` reports, as the command's telemetry would merge it."""

    reported: dict[str, Any] = {}
    monkeypatch.setattr(
        init_funnel, "update_command_telemetry", lambda **metrics: reported.update(metrics)
    )
    return reported


def test_the_funnel_stages_are_the_contract_values() -> None:
    init = contract()["EVENT_CATALOG"][COMPLETED_EVENT]["variants"]["init"]
    assert tuple(init["stage_reached"]["values"]) == init_funnel.INIT_STAGES


def test_a_completed_offline_init_reports_every_stage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, funnel_metrics: dict[str, Any]
) -> None:
    _guided_run(monkeypatch, Script("project", "", "", ""), tmp_path)
    assert main(["init"]) == 0
    assert funnel_metrics == {"stage_reached": "completed", "connection_result": "skipped"}


def test_a_failed_connection_is_reported_even_when_init_goes_offline(
    tmp_path: Path,
    catalog: Callable[..., list[Mapping[str, str]]],
    funnel_metrics: dict[str, Any],
) -> None:
    catalog(DiscoveryConnectionError("Cannot inspect ClickHouse. unreachable"))
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    funnel = init_funnel.InitFunnel()
    script = Script("", "", "3", "", "")  # folder, use env, offline, framework, create
    guide(options(), script.prompter(), cwd=tmp_path, environ=environ, funnel=funnel)
    funnel.offline()  # what _create does for the offline example
    assert funnel_metrics == {"stage_reached": "confirmed", "connection_result": "failed"}


def test_a_retried_connection_that_succeeds_is_ok(
    tmp_path: Path,
    catalog: Callable[..., list[Mapping[str, str]]],
    funnel_metrics: dict[str, Any],
) -> None:
    catalog(DiscoveryConnectionError("Cannot inspect ClickHouse. unreachable"), SMALL)
    environ = {"CLICKHOUSE_HOST": "ch.example"}
    script = Script("", "", "1", "", "", "")  # folder, use env, retry, tenant, framework, create
    run_guide(script, tmp_path, environ=environ)
    assert funnel_metrics == {"stage_reached": "confirmed", "connection_result": "ok"}


def test_declining_the_summary_reports_the_last_answered_stage(
    tmp_path: Path, funnel_metrics: dict[str, Any]
) -> None:
    with pytest.raises(SetupCancelledError):
        run_guide(Script("", "", "", "n"), tmp_path)  # folder, URL (offline), framework, no
    # Skipping the connection was already chosen, so the cancelled run still says so.
    assert funnel_metrics == {"stage_reached": "framework_selected", "connection_result": "skipped"}


def test_a_chdb_database_that_cannot_be_opened_is_a_failed_connection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, funnel_metrics: dict[str, Any]
) -> None:
    (tmp_path / "project" / "analytics.chdb").mkdir(parents=True)

    def locked(**_: object) -> CatalogOverview:
        raise DatabaseOpenError("Cannot open the chDB database. Only one process can use it.")

    monkeypatch.setattr(schema_module, "discover_catalog", locked)
    with pytest.raises(DatabaseOpenError):
        run_guide(Script("project"), tmp_path, database="chdb", framework="standalone")
    assert funnel_metrics["connection_result"] == "failed"


def test_a_missing_driver_without_a_terminal_is_a_failed_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    funnel_metrics: dict[str, Any],
) -> None:
    monkeypatch.setattr(schema_module, "find_spec", lambda _name: None)
    assert main(["init", str(tmp_path / "project"), "--no-interactive"]) == 1
    assert 'pip install "hypequery[clickhouse]"' in capsys.readouterr().err
    assert funnel_metrics == {"stage_reached": "started", "connection_result": "failed"}


def test_a_schema_error_after_connecting_is_not_a_connection_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, funnel_metrics: dict[str, Any]
) -> None:
    def missing(**_: object) -> Schema:
        raise CliError("Requested tables do not exist: nope")

    monkeypatch.setattr(schema_module, "discover_schema", missing)
    assert main(["init", str(tmp_path / "project"), "--no-interactive"]) == 1
    assert "connection_result" not in funnel_metrics


def test_an_unreachable_database_reports_where_init_stopped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, funnel_metrics: dict[str, Any]
) -> None:
    def unreachable(**_: object) -> Schema:
        raise DiscoveryConnectionError("Cannot inspect ClickHouse. ClickHouse is unreachable.")

    monkeypatch.setattr(schema_module, "discover_schema", unreachable)
    assert main(["init", str(tmp_path / "project"), "--no-interactive"]) == 1
    assert funnel_metrics == {"stage_reached": "started", "connection_result": "failed"}
