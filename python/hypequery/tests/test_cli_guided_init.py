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
from hypequery.cli.errors import CliError
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
    script = Script("", "", "", "2", "")  # folder, use env, tenant yes, django, create
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
            assert parameters["hints"] == ["org_id", "tenant_id"]
            return Result([("org_id", "customers"), ("org_id", "orders")])

        def close(self) -> None:
            pass

    @contextmanager
    def connected(_environ: Mapping[str, str]) -> Iterator[tuple[Client, dict[str, object]]]:
        yield Client(), {}

    monkeypatch.setattr(schema_module, "_connected", connected)
    monkeypatch.setattr(schema_module, "_catalog_settings", lambda _client: {})
    overview = schema_module.discover_catalog(environ={}, tenant_hints=("tenant_id", "org_id"))
    assert overview == CatalogOverview(
        "analytics", ("customers", "orders"), {"org_id": ("customers", "orders")}
    )


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
            return Result([("Org_ID", "orders")])

        def close(self) -> None:
            pass

    @contextmanager
    def connected(_environ: Mapping[str, str]) -> Iterator[tuple[Client, dict[str, object]]]:
        yield Client(), {}

    monkeypatch.setattr(schema_module, "_connected", connected)
    monkeypatch.setattr(schema_module, "_catalog_settings", lambda _client: {})
    overview = schema_module.discover_catalog(environ={}, tenant_hints=("ORG_ID",))
    assert seen["hints"] == ["org_id"]
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
