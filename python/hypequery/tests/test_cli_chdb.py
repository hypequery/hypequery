"""``init`` and ``generate datasets`` on embedded ClickHouse (chDB).

chDB holds one database path per process, so every step that opens an on-disk
database runs in a subprocess, as the CLI and the app do in real use.
"""

from __future__ import annotations

import ast
import json
import shutil
import subprocess
import sys
import textwrap
import tomllib
from importlib.util import find_spec
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.commands import generate as generate_command
from hypequery.cli.generators import schema as schema_module
from hypequery.cli.generators.schema import CatalogOverview
from hypequery.cli.options import GenerateDatasetsOptions
from test_cli_guided_init import Script, run_guide

needs_chdb = pytest.mark.skipif(find_spec("chdb") is None, reason="chdb is not installed")


def hypequery(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "hypequery", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": "/usr/bin:/bin", "CI": "1"},
    )


def python(source: str, *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def readme_seed(project: Path) -> str:
    """The seeding script the scaffold's README tells the user to run."""

    readme = (project / "README.md").read_text()
    return readme.split("python - <<'PY'\n", 1)[1].split("\nPY\n", 1)[0]


def test_chdb_path_implies_the_chdb_database(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        main(["init", "x", "--database", "clickhouse", "--chdb-path", "a.chdb"])
    assert "--chdb-path needs --database chdb" in capsys.readouterr().err


def test_django_and_flask_need_a_clickhouse_server(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    for framework in ("django", "flask"):
        assert main(["init", str(tmp_path / framework), "--database", "chdb",
                     "--framework", framework, "--no-interactive"]) == 1  # fmt: skip
        assert "connects to a ClickHouse server" in capsys.readouterr().err
    assert not (tmp_path / "django").exists()


def test_a_new_database_scaffolds_the_example_on_chdb(tmp_path: Path) -> None:
    project = tmp_path / "project"
    assert main(["init", str(project), "--database", "chdb", "--no-interactive"]) == 0
    app = (project / "app.py").read_text()
    assert 'create_chdb_executor(str(Path(__file__).parent / "analytics.chdb"))' in app
    assert "ClickHouseConnection" not in app
    assert "hypequery[server,chdb]" in (project / "pyproject.toml").read_text()
    assert "CLICKHOUSE_" not in (project / ".env.example").read_text()
    assert (project / ".gitignore").read_text().endswith("analytics.chdb/\n")
    readme = (project / "README.md").read_text()
    assert "CLICKHOUSE_" not in readme
    assert "KILL QUERY" not in readme
    assert 'chdb.connect("analytics.chdb")' in readme
    # init never creates the database itself.
    assert not (project / "analytics.chdb").exists()
    assert not (project / "schema.json").exists()


def test_the_fastapi_app_opens_the_database_beside_it(tmp_path: Path) -> None:
    project = tmp_path / "project"
    args = ["init", str(project), "--chdb-path", "data/db.chdb", "--framework", "fastapi"]
    assert main([*args, "--no-interactive"]) == 0
    app = (project / "app.py").read_text()
    assert 'create_chdb_executor(str(Path(__file__).parent / "data/db.chdb"))' in app
    assert "import secrets\nfrom pathlib import Path\n" in app
    assert "HYPEQUERY_DEV_TOKEN" in (project / "README.md").read_text()
    assert (project / ".gitignore").read_text().endswith("data/db.chdb/\n")


@needs_chdb
def test_the_example_seeds_serves_and_regenerates_from_chdb(tmp_path: Path) -> None:
    project = tmp_path / "project"
    assert main(["init", str(project), "--database", "chdb", "--no-interactive"]) == 0
    seeded = python(readme_seed(project), cwd=project)
    assert seeded.returncode == 0, seeded.stderr
    served = python(
        """
        import json, sys
        sys.path.insert(0, ".")
        import app
        from hypequery.datasets import DatasetQuery
        from hypequery.datasets.query_helpers import desc, eq

        result = app.client.execute(
            app.datasets["orders"],
            DatasetQuery(
                dimensions=("country",),
                measures=("revenue", "orderCount"),
                filters=(eq("status", "paid"),),
                order_by=(desc("revenue"),),
            ),
        )
        print(json.dumps(list(result.data)))
        """,
        cwd=project,
    )
    assert served.returncode == 0, served.stderr
    assert json.loads(served.stdout) == [
        {"country": "US", "revenue": "310.25", "orderCount": 1},
        {"country": "NZ", "revenue": "200.50", "orderCount": 2},
        {"country": "AU", "revenue": "200.00", "orderCount": 1},
    ]
    regenerated = hypequery("generate", "datasets", "--diff", cwd=project)
    assert "recorded in pyproject.toml (analytics.chdb)" in regenerated.stdout
    assert "'orders': dataset(" in regenerated.stdout


@needs_chdb
def test_init_reads_an_existing_database_and_generate_reuses_it(tmp_path: Path) -> None:
    created = python(
        """
        import chdb
        connection = chdb.connect("shared.chdb")
        connection.query(
            "CREATE TABLE events (id UInt64, org_id String, kind String) "
            "ENGINE = MergeTree ORDER BY id"
        )
        connection.close()
        """,
        cwd=tmp_path,
    )
    assert created.returncode == 0, created.stderr
    init = hypequery(
        "init", "project", "--chdb-path", "../shared.chdb", "--tenant-column", "org_id",
        "--no-interactive", cwd=tmp_path,
    )  # fmt: skip
    assert init.returncode == 0, init.stderr
    project = tmp_path / "project"
    assert 'chdb-path = "../shared.chdb"' in (project / "pyproject.toml").read_text()
    snapshot = json.loads((project / "schema.json").read_text())
    assert [table["table"] for table in snapshot["tables"]] == ["events"]
    assert "tenant_key='org_id'" in (project / "datasets.py").read_text()
    # A database outside the project is not the project's to ignore.
    assert "shared.chdb" not in (project / ".gitignore").read_text()
    check = hypequery("generate", "datasets", "--check", cwd=project)
    assert check.returncode == 0, check.stderr
    assert "Using the chDB database init recorded in pyproject.toml" in check.stdout


@needs_chdb
def test_a_database_another_process_holds_is_reported_actionably(tmp_path: Path) -> None:
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import chdb, sys, time\n"
            "c = chdb.connect('analytics.chdb')\n"
            "c.query('CREATE TABLE t (x UInt8) ENGINE = Memory')\n"
            "print('ready', flush=True)\n"
            "time.sleep(30)\n",
        ],
        cwd=tmp_path,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "ready"
        held = hypequery("generate", "datasets", "--database", "chdb", cwd=tmp_path)
    finally:
        holder.kill()
        holder.wait()
    assert held.returncode == 1
    assert "Only one process can use it at a time" in held.stderr
    assert "hypequery dev" in held.stderr


def test_a_missing_database_is_never_created_by_generate(tmp_path: Path) -> None:
    missing = hypequery("generate", "datasets", "--chdb-path", "nowhere.chdb", cwd=tmp_path)
    assert missing.returncode == 1
    assert "There is no chDB database at nowhere.chdb" in missing.stderr
    assert not (tmp_path / "nowhere.chdb").exists()


def _generate_options(**overrides: object) -> GenerateDatasetsOptions:
    values: dict[str, object] = {
        "output": None,
        "path": None,
        "tables": None,
        "exclude_tables": None,
        "tenant_column": None,
        "no_tenant_column": False,
        "all_tables": False,
        "check": False,
        "diff": False,
        "force": False,
    }
    values.update(overrides)
    return GenerateDatasetsOptions(**values)  # type: ignore[arg-type]


def test_clickhouse_settings_win_over_a_local_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # No pyproject.toml records a path, so a project analytics.chdb is the candidate.
    (tmp_path / "analytics.chdb").mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CLICKHOUSE_URL", raising=False)
    monkeypatch.delenv("CLICKHOUSE_HOST", raising=False)
    output = tmp_path / "datasets.py"
    local = tmp_path / "analytics.chdb"
    choose = generate_command._chdb_path
    assert choose(_generate_options(), output) == local
    assert choose(_generate_options(database="clickhouse"), output) is None
    monkeypatch.setenv("CLICKHOUSE_HOST", "ch.example")
    assert choose(_generate_options(), output) is None
    assert choose(_generate_options(database="chdb"), output) == local
    assert choose(_generate_options(chdb_path="x.chdb"), output) == Path("x.chdb")


def test_guided_init_with_chdb_offers_only_the_apps_it_can_serve(tmp_path: Path) -> None:
    script = Script("", "", "")  # folder, framework, create
    guided = run_guide(script, tmp_path, database="chdb")
    assert guided.options.database == "chdb"
    assert guided.environ is None
    assert not guided.options.skip_connection
    assert "There is no chDB database" in script.text
    assert "Django" not in script.text
    assert "ClickHouse URL" not in script.text
    assert "--database chdb" in script.text


@needs_chdb
def test_a_custom_path_for_a_new_database_is_regenerated_from(tmp_path: Path) -> None:
    project = tmp_path / "project"
    assert main(["init", str(project), "--chdb-path", "data/db.chdb", "--no-interactive"]) == 0
    assert 'chdb-path = "data/db.chdb"' in (project / "pyproject.toml").read_text()
    seeded = python(readme_seed(project), cwd=project)
    assert seeded.returncode == 0, seeded.stderr
    assert (project / "data" / "db.chdb").is_dir()
    regenerated = hypequery("generate", "datasets", "--diff", cwd=project)
    assert "recorded in pyproject.toml (data/db.chdb)" in regenerated.stdout
    assert "'orders': dataset(" in regenerated.stdout


def _fake_catalog(monkeypatch: pytest.MonkeyPatch) -> list[Path | None]:
    read: list[Path | None] = []

    def fake(*, chdb_path: Path | None = None, **_: object) -> CatalogOverview:
        read.append(chdb_path)
        return CatalogOverview("default", ("events",), {})

    monkeypatch.setattr(schema_module, "discover_catalog", fake)
    return read


def test_guided_init_keeps_an_explicit_skip_connection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "analytics.chdb").mkdir()
    read = _fake_catalog(monkeypatch)
    script = Script("", "", "")  # folder, framework, create
    guided = run_guide(script, tmp_path, database="chdb", skip_connection=True)
    assert guided.options.skip_connection
    assert read == []


def test_guided_init_reads_the_database_in_the_folder_it_settles_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "notes.txt").write_text("")
    (tmp_path / "analytics").mkdir()
    (tmp_path / "analytics" / "app.py").write_text("")
    (tmp_path / "elsewhere" / "analytics.chdb").mkdir(parents=True)
    read = _fake_catalog(monkeypatch)
    # folder (default analytics), framework, the clash's new folder, create
    script = Script("", "", "elsewhere", "")
    guided = run_guide(script, tmp_path, database="chdb")
    assert guided.options.directory == "elsewhere"
    assert read == [tmp_path / "elsewhere" / "analytics.chdb"]


@pytest.mark.parametrize("path", ["😀.chdb", "données/été.chdb", 'q"uote\\d.chdb'])
def test_any_path_reads_back_exactly_from_generated_files(tmp_path: Path, path: str) -> None:
    project = tmp_path / "project"
    assert main(["init", str(project), "--chdb-path", path, "--no-interactive"]) == 0
    pyproject = tomllib.loads((project / "pyproject.toml").read_text(encoding="utf-8"))
    assert pyproject["tool"]["hypequery"]["chdb-path"] == path
    app = ast.parse((project / "app.py").read_text(encoding="utf-8"))
    constants = [node.value for node in ast.walk(app) if isinstance(node, ast.Constant)]
    assert constants.count(path) == 1


GIT = shutil.which("git")


@pytest.mark.skipif(GIT is None, reason="git is not installed")
@pytest.mark.parametrize(
    "path", ["data[2026].chdb", "#notes.chdb", "!keep.chdb", "a*b?.chdb", "trailing .chdb "]
)
def test_the_database_directory_is_really_ignored(tmp_path: Path, path: str) -> None:
    def ignored(name: str) -> bool:
        check = [str(GIT), "check-ignore", "-q", name]
        return subprocess.run(check, cwd=project, check=False).returncode == 0

    project = tmp_path / "project"
    assert main(["init", str(project), "--chdb-path", path, "--no-interactive"]) == 0
    subprocess.run([str(GIT), "init", "-q"], cwd=project, check=True)
    for directory in (path, "kept.chdb"):
        (project / directory).mkdir(parents=True)
        (project / directory / "data.bin").write_text("")
    assert ignored(f"{path}/data.bin")
    # The pattern names that directory only, not every path its characters could match.
    assert not ignored("kept.chdb/data.bin")
