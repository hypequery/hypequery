"""``init`` and ``generate datasets`` on embedded ClickHouse (chDB).

chDB holds one database path per process, so every step that opens an on-disk
database runs in a subprocess, as the CLI and the app do in real use.
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from importlib.util import find_spec
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.commands import generate as generate_command
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
    assert "Using the chDB database at " in regenerated.stdout
    assert "analytics.chdb; set CLICKHOUSE_URL" in regenerated.stdout
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
    snapshot = json.loads((project / "schema.json").read_text())
    assert snapshot["chdbPath"] == "../shared.chdb"
    assert [table["table"] for table in snapshot["tables"]] == ["events"]
    assert "tenant_key='org_id'" in (project / "datasets.py").read_text()
    # A database outside the project is not the project's to ignore.
    assert "shared.chdb" not in (project / ".gitignore").read_text()
    check = hypequery("generate", "datasets", "--check", cwd=project)
    assert check.returncode == 0, check.stderr
    assert "Using the chDB database init recorded in schema.json" in check.stdout


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
    (tmp_path / "analytics.chdb").mkdir()
    monkeypatch.delenv("CLICKHOUSE_URL", raising=False)
    monkeypatch.delenv("CLICKHOUSE_HOST", raising=False)
    choose = generate_command._chdb_path
    assert choose(_generate_options(), tmp_path) == tmp_path / "analytics.chdb"
    assert choose(_generate_options(database="clickhouse"), tmp_path) is None
    monkeypatch.setenv("CLICKHOUSE_HOST", "ch.example")
    assert choose(_generate_options(), tmp_path) is None
    assert choose(_generate_options(database="chdb"), tmp_path) == tmp_path / "analytics.chdb"
    assert choose(_generate_options(chdb_path="x.chdb"), tmp_path) == Path("x.chdb")


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
