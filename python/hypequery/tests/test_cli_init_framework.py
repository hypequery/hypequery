"""`hypequery init --framework django|flask` scaffolds."""

from __future__ import annotations

import importlib.util
import py_compile
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest

from contrib_doubles import install_executors
from hypequery.cli import main
from hypequery.cli.generators.schema import Column, ConnectionSummary, Schema, Table

SCHEMA = Schema(
    "analytics",
    (
        Table("orders", (Column("id", "UInt64"), Column("org_id", "String"))),
        Table("lookups", (Column("code", "String"),)),
    ),
    ConnectionSummary("localhost", 18123, False, from_url=True),
)


@pytest.fixture(autouse=True)
def discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("hypequery.cli.generators.schema.discover_schema", lambda **_: SCHEMA)


def _init(tmp_path: Path, *argv: str) -> Path:
    project = tmp_path / "project"
    assert main(["init", str(project), *argv]) == 0
    return project


def test_fastapi_stays_the_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    project = _init(tmp_path)
    assert (project / "app.py").exists()
    assert "hypequery[fastapi,clickhouse]" in (project / "pyproject.toml").read_text()
    assert "Then run: cd" in capsys.readouterr().out


def test_django_scaffold(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    project = _init(tmp_path, "--framework", "django", "--tenant-column", "org_id")
    assert not (project / "app.py").exists()
    module = (project / "analytics.py").read_text()
    py_compile.compile(str(project / "analytics.py"), doraise=True)
    assert '"REGISTRY": "analytics.registry"' in module
    assert "    import analytics\n" in module
    assert "Datasets are scoped by 'org_id'" in module
    pyproject = (project / "pyproject.toml").read_text()
    assert "hypequery[django]" in pyproject
    assert 'py-modules = ["analytics", "datasets"]' in pyproject
    readme = (project / "README.md").read_text()
    assert "## Use it from Django" in readme
    assert "HYPEQUERY_DEV_TOKEN" not in readme
    assert "[fastapi,clickhouse]" not in readme
    assert "HYPEQUERY_DEV_TOKEN" not in (project / ".env.example").read_text()
    out = capsys.readouterr().out
    assert "add datasets.py and analytics.py to your Django project" in out
    assert "hypequery dev" not in out


@pytest.fixture
def isolated_modules() -> Iterator[None]:
    """Restore the app/datasets module entries a generated project's import replaces."""

    names = ("app", "datasets")
    saved = {name: sys.modules.pop(name) for name in names if name in sys.modules}
    try:
        yield
    finally:
        for name in names:
            sys.modules.pop(name, None)
        sys.modules.update(saved)


def _load_flask_app(project: Path, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.syspath_prepend(str(project))
    spec = importlib.util.spec_from_file_location("app", project / "app.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["app"] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.usefixtures("isolated_modules")
def test_flask_scaffold_runs_and_refuses_tenant_data_until_wired(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pytest.importorskip("flask")
    project = _init(tmp_path, "--framework", "flask", "--tenant-column", "org_id")
    assert "Then run: cd" in capsys.readouterr().out
    assert "hypequery[flask]" in (project / "pyproject.toml").read_text()
    readme = (project / "README.md").read_text()
    assert "flask --app app run --port 5001" in readme
    assert "HYPEQUERY_DEV_TOKEN" not in readme

    monkeypatch.setenv("CLICKHOUSE_URL", "clickhouse://localhost:18123/analytics")
    for name in ("CLICKHOUSE_HOST", "CLICKHOUSE_PORT", "CLICKHOUSE_DATABASE"):
        monkeypatch.delenv(name, raising=False)
    built = install_executors(monkeypatch)
    module = _load_flask_app(project, monkeypatch)
    http = module.app.test_client()
    # orders has a tenant_key and the stub returns None: refused, not every tenant.
    refused = http.get("/analytics/orders")
    assert (refused.status_code, refused.json) == (403, {"error": "tenant-required"})
    assert http.get("/analytics/lookups").status_code == 200
    assert http.get("/analytics/nope").status_code == 404
    assert len(built.sync) == 1
    with module.app.app_context():
        module.hq.close()


def test_framework_needs_discovery(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["init", str(tmp_path / "p"), "--skip-connection", "--framework", "flask"])
    assert exc.value.code == 2


def test_framework_files_are_preflighted(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "analytics.py").write_text("# mine\n")
    assert main(["init", str(project), "--framework", "django"]) == 1
    assert "analytics.py" in capsys.readouterr().err
    assert (project / "analytics.py").read_text() == "# mine\n"


def test_the_generated_project_modules_do_not_leak() -> None:
    # Runs after the Flask scaffold test in this module: its datasets module is gone.
    leaked = sys.modules.get("datasets")
    assert leaked is None or "project" not in str(getattr(leaked, "__file__", ""))
