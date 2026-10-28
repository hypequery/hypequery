"""`hypequery init --framework standalone|django|flask` scaffolds.

Each generated app is imported and served in a fresh process
(`scaffold_driver.py`), with ClickHouse replaced by a double.
"""

from __future__ import annotations

import json
import os
import py_compile
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

import pytest

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
DRIVER = Path(__file__).with_name("scaffold_driver.py")
TOKEN = {"Authorization": "Bearer dev-secret"}
SAME_ORIGIN = {"Sec-Fetch-Site": "same-origin"}
REVENUE = {"measures": ["revenue", "orderCount"]}
REVENUE_ROWS = {"columns": ["revenue", "orderCount"], "rows": [["760.75", 5]]}
SERVED_REVENUE = {"data": [{"revenue": "760.75", "orderCount": "5"}]}


@pytest.fixture(autouse=True)
def discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("hypequery.cli.generators.schema.discover_schema", lambda **_: SCHEMA)


def _init(tmp_path: Path, *argv: str) -> Path:
    project = tmp_path / "project"
    assert main(["init", str(project), *argv]) == 0
    return project


def _serve(
    framework: str,
    project: Path,
    requests: list[dict[str, Any]],
    rows: dict[str, Any] = REVENUE_ROWS,
    *,
    edit: dict[str, tuple[str, str]] | None = None,
) -> list[tuple[int, Any]]:
    """Serve *requests* from the generated app, optionally after editing its files."""

    for name, (old, new) in (edit or {}).items():
        source = (project / name).read_text()
        assert old in source, f"{name} no longer contains the line the test wires"
        (project / name).write_text(source.replace(old, new))
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CLICKHOUSE_", "HYPEQUERY_", "DJANGO_"))
    }
    env["CLICKHOUSE_URL"] = "clickhouse://localhost:18123/analytics"
    env["HYPEQUERY_DEV_TOKEN"] = "dev-secret"  # noqa: S105 - the test's token
    result = subprocess.run(
        [sys.executable, str(DRIVER), framework, str(project)],
        input=json.dumps({"rows": rows, "requests": requests}),
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return [tuple(reply) for reply in json.loads(result.stdout.splitlines()[-1])]


def _post(path: str, body: Any = REVENUE, **request: Any) -> dict[str, Any]:
    return {"method": "POST", "path": path, "json": body, **request}


def _get(path: str, **request: Any) -> dict[str, Any]:
    return {"method": "GET", "path": path, **request}


def test_standalone_is_the_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    project = _init(tmp_path)
    assert {"app.py", "datasets.py"} <= {path.name for path in project.iterdir()}
    pyproject = tomllib.loads((project / "pyproject.toml").read_text())
    assert pyproject["project"]["dependencies"][0].startswith("hypequery[server,clickhouse]==")
    assert pyproject["tool"]["setuptools"]["py-modules"] == ["app", "datasets"]
    assert "import fastapi" not in (project / "app.py").read_text()
    assert "from fastapi" not in (project / "app.py").read_text()
    assert "Then run: cd" in capsys.readouterr().out


def test_the_framework_choices_are_named_for_what_they_write() -> None:
    with pytest.raises(SystemExit) as exc:
        main(["init", "--framework", "fastapi", "--skip-connection"])
    assert exc.value.code == 2


@pytest.mark.parametrize("framework", ["standalone", "django", "flask"])
def test_offline_examples_exist_for_every_framework(
    tmp_path: Path, framework: str, capsys: pytest.CaptureFixture[str]
) -> None:
    project = _init(tmp_path, "--skip-connection", "--framework", framework)
    names = {path.name for path in project.iterdir()}
    assert {"datasets.py", "seed.sql", "README.md", ".env.example"} <= names
    readme = (project / "README.md").read_text()
    # The example query and the seed's answer to it, for every framework.
    assert '"orderCount":"2"' in readme
    assert "HYPEQUERY_DEV_TOKEN=\n" in (project / ".env.example").read_text()
    assert "Created an offline orders example" in capsys.readouterr().out


def test_offline_standalone_serves_its_dataset(tmp_path: Path) -> None:
    project = _init(tmp_path, "--skip-connection")
    replies = _serve(
        "standalone",
        project,
        [
            _post("/datasets/orders/query", headers=TOKEN),
            _post("/datasets/orders/query"),
        ],
    )
    assert replies == [
        (200, SERVED_REVENUE),
        (401, replies[1][1]),
    ]


def test_django_scaffold(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    project = _init(tmp_path, "--framework", "django", "--tenant-column", "org_id")
    assert not (project / "app.py").exists()
    for name in ("analytics.py", "urls.py", "settings.py", "manage.py"):
        py_compile.compile(str(project / name), doraise=True)
    analytics = (project / "analytics.py").read_text()
    assert "Datasets are scoped by 'org_id': return the signed-in user's" in analytics
    assert "__TENANT_HINT__" not in analytics
    settings = (project / "settings.py").read_text()
    assert '"REGISTRY": "analytics.registry"' in settings
    assert "__DJANGO_SECRET_KEY__" not in settings
    urls = (project / "urls.py").read_text()
    assert "django_user(analytics.principal_for_user)" in urls
    pyproject = tomllib.loads((project / "pyproject.toml").read_text())
    assert pyproject["project"]["dependencies"][0].startswith("hypequery[django]==")
    assert pyproject["tool"]["setuptools"]["py-modules"] == ["analytics", "datasets"]
    readme = (project / "README.md").read_text()
    assert "## Run with Django" in readme
    assert "/api/agents/orders" in readme
    assert "the token API refuses them" in readme
    assert "[server,clickhouse]" not in readme
    assert "DJANGO_SECRET_KEY=" in (project / ".env.example").read_text()
    assert "db.sqlite3" in (project / ".gitignore").read_text()
    out = capsys.readouterr().out
    assert "python manage.py migrate && python manage.py runserver" in out
    assert "hypequery dev" not in out


def test_each_django_project_gets_its_own_secret_key(tmp_path: Path) -> None:
    keys = set()
    for name in ("one", "two"):
        assert main(["init", str(tmp_path / name), "--framework", "django"]) == 0
        settings = (tmp_path / name / "settings.py").read_text()
        keys.add(next(line for line in settings.splitlines() if "django-insecure-" in line))
    assert len(keys) == 2


def test_django_scaffold_serves_both_apis(tmp_path: Path) -> None:
    pytest.importorskip("django")
    project = _init(tmp_path, "--skip-connection", "--framework", "django")
    replies = _serve(
        "django",
        project,
        [
            # The agents' API takes a header credential, so it needs no CSRF token.
            _post("/api/agents/orders", headers=TOKEN),
            _post("/api/agents/orders"),
            _post("/api/agents/orders", headers={"Authorization": "Bearer wrong"}),
            _get("/api/agents/client-contract", headers=TOKEN),
            # Django's own login, with the same-origin check and Django's CSRF.
            _post("/api/analytics/orders", headers=SAME_ORIGIN, signed_in=True, csrf=True),
            _post("/api/analytics/orders", headers=SAME_ORIGIN, csrf=True),
            _post(
                "/api/analytics/orders",
                headers={"Sec-Fetch-Site": "cross-site"},
                signed_in=True,
                csrf=True,
            ),
            # A token is not a session.
            _post("/api/analytics/orders", headers={**TOKEN, **SAME_ORIGIN}, csrf=True),
            _get("/analytics/orders", signed_in=True),
            # Without the CSRF token, Django refuses a signed-in POST itself.
            _post("/api/analytics/orders", headers=SAME_ORIGIN, signed_in=True),
        ],
    )
    assert replies[0] == (200, SERVED_REVENUE)
    assert [status for status, _ in replies[1:3]] == [401, 401]
    assert [endpoint["path"] for endpoint in replies[3][1]["endpoints"]] == ["/api/agents/orders"]
    assert replies[4] == (200, SERVED_REVENUE)
    assert replies[5][0] == 401
    assert replies[6][0] == 403
    assert replies[6][1]["error"]["details"] == {"reason": "cross_origin"}
    assert replies[7][0] == 401
    assert replies[8] == (200, {"data": [{"revenue": "760.75", "orderCount": 5}]})
    # Django's CSRF failure page, not the API's envelope: the middleware answered.
    assert replies[9][0] == 403
    assert "CSRF" in str(replies[9][1])


def test_django_scaffold_keeps_csrf_protection(tmp_path: Path) -> None:
    project = _init(tmp_path, "--skip-connection", "--framework", "django")
    settings = (project / "settings.py").read_text()
    assert "django.middleware.csrf.CsrfViewMiddleware" in settings


def test_django_scaffold_refuses_tenant_data_until_wired(tmp_path: Path) -> None:
    pytest.importorskip("django")
    project = _init(tmp_path, "--framework", "django", "--tenant-column", "org_id")
    rows = {"columns": ["totalCount"], "rows": [[3]]}
    count = {"measures": ["totalCount"]}
    requests = [
        _post("/api/analytics/orders", count, headers=SAME_ORIGIN, signed_in=True, csrf=True),
        _post("/api/agents/orders", count, headers=TOKEN),
        _post("/api/analytics/lookups", count, headers=SAME_ORIGIN, signed_in=True, csrf=True),
        _get("/analytics/orders", signed_in=True),
    ]
    refused = _serve("django", project, requests, rows)
    assert [status for status, _ in refused] == [403, 403, 200, 403]
    wired = _serve(
        "django",
        project,
        requests,
        rows,
        edit={
            "analytics.py": (
                "    return None\n\n\ndef principal_for_user",
                '    return "acme"\n\n\ndef principal_for_user',
            )
        },
    )
    assert [status for status, _ in wired] == [200, 403, 200, 200]


def test_flask_scaffold(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    project = _init(tmp_path, "--framework", "flask", "--tenant-column", "org_id")
    py_compile.compile(str(project / "app.py"), doraise=True)
    assert "set tenant_id to the signed-in user's" in (project / "app.py").read_text()
    assert "Then run: cd" in capsys.readouterr().out
    assert "hypequery[flask]" in (project / "pyproject.toml").read_text()
    readme = (project / "README.md").read_text()
    assert "flask --app app run --port 5001" in readme
    assert "http://127.0.0.1:5001/api/agents/orders" in readme
    assert "FLASK_SECRET_KEY=" in (project / ".env.example").read_text()


def test_flask_scaffold_serves_both_apis(tmp_path: Path) -> None:
    pytest.importorskip("flask")
    project = _init(tmp_path, "--skip-connection", "--framework", "flask")
    requests = [
        _post("/api/agents/orders", headers=TOKEN),
        _post("/api/agents/orders"),
        _get("/api/agents/client-contract", headers=TOKEN),
        _post("/api/analytics/orders", headers=SAME_ORIGIN, signed_in=True),
        _get("/analytics/orders", signed_in=True),
        _post("/api/analytics/orders", headers={"Sec-Fetch-Site": "cross-site"}, signed_in=True),
    ]
    # Until principal_for_session reads a login, the session API serves no one.
    unwired = _serve("flask", project, requests)
    assert unwired[0] == (200, SERVED_REVENUE)
    assert unwired[1][0] == 401
    assert [endpoint["path"] for endpoint in unwired[2][1]["endpoints"]] == ["/api/agents/orders"]
    assert [status for status, _ in unwired[3:]] == [401, 401, 403]
    wired = _serve(
        "flask",
        project,
        requests,
        edit={
            "app.py": (
                "    return None\n\n\ndef principal_for_token",
                '    user = current.get("user_id")\n'
                "    return Principal(subject=user) if user else None\n\n\n"
                "def principal_for_token",
            )
        },
    )
    assert wired[3] == (200, SERVED_REVENUE)
    assert wired[4] == (200, {"data": [{"revenue": "760.75", "orderCount": 5}]})
    assert wired[5][0] == 403


def test_framework_files_are_preflighted(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "urls.py").write_text("# mine\n")
    assert main(["init", str(project), "--framework", "django"]) == 1
    assert "urls.py" in capsys.readouterr().err
    assert (project / "urls.py").read_text() == "# mine\n"
    assert main(["init", str(project), "--skip-connection", "--framework", "django"]) == 1
    assert (project / "urls.py").read_text() == "# mine\n"
    assert not (project / "analytics.py").exists()
