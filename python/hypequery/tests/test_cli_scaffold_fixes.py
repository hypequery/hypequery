"""Scaffold and regeneration fixes found by building framework demos.

- the scaffold documents the connection discovery actually used (URL or fields);
- init accepts --tenant-column;
- regeneration reuses the table selection init was given, unless told otherwise;
- review notes name the flag that sets a tenant key;
- printed paths are normalised.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from hypequery.cli import main
from hypequery.cli.generators.schema import Column, ConnectionSummary, Schema, Table

ORDERS = Table("orders", (Column("id", "UInt64"), Column("org_id", "String")))
CUSTOMERS = Table("customers", (Column("id", "UInt64"), Column("org_id", "String")))


def _schema(connection: ConnectionSummary | None, *tables: Table) -> Schema:
    return Schema("analytics", tables or (ORDERS,), connection)


@pytest.fixture
def init_discovery(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    connection = ConnectionSummary("ch.internal", 18123, False, from_url=False)

    def discover(**kwargs: Any) -> Schema:
        calls.append(kwargs)
        return _schema(connection, ORDERS, CUSTOMERS)

    monkeypatch.setattr("hypequery.cli.generators.schema.discover_schema", discover)
    return calls


def test_scaffold_documents_the_fields_discovery_used(
    tmp_path: Path, init_discovery: list[dict[str, Any]]
) -> None:
    assert main(["init", str(tmp_path / "app")]) == 0
    env = (tmp_path / "app" / ".env.example").read_text()
    assert "CLICKHOUSE_HOST=ch.internal\nCLICKHOUSE_PORT=18123\n" in env
    assert "CLICKHOUSE_DATABASE=analytics" in env
    assert "CLICKHOUSE_URL" not in env
    readme = (tmp_path / "app" / "README.md").read_text()
    assert "export CLICKHOUSE_HOST=ch.internal\nexport CLICKHOUSE_PORT=18123\n" in readme
    assert "CLICKHOUSE_URL" in (tmp_path / "app" / "app.py").read_text()


def test_scaffold_documents_a_url_without_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = ConnectionSummary("ch.example.com", None, True, from_url=True)
    monkeypatch.setattr(
        "hypequery.cli.generators.schema.discover_schema", lambda **_: _schema(connection)
    )
    assert main(["init", str(tmp_path / "app")]) == 0
    env = (tmp_path / "app" / ".env.example").read_text()
    assert "CLICKHOUSE_URL=clickhouses://USERNAME:PASSWORD@ch.example.com/analytics" in env
    assert "CLICKHOUSE_HOST=" not in env
    readme = (tmp_path / "app" / "README.md").read_text()
    assert (
        "export CLICKHOUSE_URL='clickhouses://USERNAME:PASSWORD@ch.example.com/analytics'" in readme
    )
    assert "export CLICKHOUSE_HOST" not in readme


def test_ipv6_hosts_are_bracketed_in_urls(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    connection = ConnectionSummary("::1", 8123, False, from_url=True)
    monkeypatch.setattr(
        "hypequery.cli.generators.schema.discover_schema", lambda **_: _schema(connection)
    )
    assert main(["init", str(tmp_path / "app")]) == 0
    assert "@[::1]:8123/analytics" in (tmp_path / "app" / ".env.example").read_text()


def test_discovery_records_how_it_connected(monkeypatch: pytest.MonkeyPatch) -> None:
    import clickhouse_connect

    from hypequery.cli.generators import schema as discovery

    class _Client:
        def close(self) -> None:
            pass

    monkeypatch.setattr(clickhouse_connect, "get_client", lambda **_: _Client())
    monkeypatch.setattr(discovery, "read_schema", lambda client, **_: _schema(None))
    for name in ("CLICKHOUSE_HOST", "CLICKHOUSE_PORT", "CLICKHOUSE_SECURE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CLICKHOUSE_URL", "clickhouses://u:secret@ch.example.com:9440/analytics")
    found = discovery.discover_schema(tables=None, exclude_tables=None)
    assert found.connection == ConnectionSummary("ch.example.com", 9440, True, from_url=True)


def test_init_sets_the_tenant_column(tmp_path: Path, init_discovery: list[dict[str, Any]]) -> None:
    assert main(["init", str(tmp_path / "app"), "--tenant-column", "org_id"]) == 0
    assert (tmp_path / "app" / "datasets.py").read_text().count("tenant_key='org_id'") == 2
    readme = (tmp_path / "app" / "README.md").read_text()
    assert "hypequery generate datasets --tenant-column org_id --diff" in readme


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--skip-connection", "--tenant-column", "org_id"], "require a database connection"),
    ],
)
def test_init_tenant_column_needs_discovery(argv: list[str], message: str, tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["init", str(tmp_path / "app"), *argv])
    assert exc.value.code == 2


def test_init_refuses_an_unsafe_tenant_column_before_discovery(
    tmp_path: Path, init_discovery: list[dict[str, Any]], capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["init", str(tmp_path / "app"), "--tenant-column", "org id"]) == 1
    assert "identifier grammar" in capsys.readouterr().err
    assert init_discovery == []


def test_regeneration_reuses_the_selection_init_was_given(
    tmp_path: Path,
    init_discovery: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project), "--tables", "orders", "--tenant-column", "org_id"]) == 0
    assert json.loads((project / "schema.json").read_text())["selection"] == {"tables": "orders"}
    readme = (project / "README.md").read_text()
    assert "hypequery generate datasets --tables orders --tenant-column org_id --diff" in readme

    regenerate: list[dict[str, Any]] = []

    def discover(**kwargs: Any) -> Schema:
        regenerate.append(kwargs)
        return _schema(None, ORDERS)

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    capsys.readouterr()
    assert main(["generate", "datasets", "--path", str(project), "--check"]) == 1
    assert regenerate[-1] == {"tables": "orders", "exclude_tables": None}
    assert "selection init recorded in schema.json (--tables orders)" in capsys.readouterr().out

    main(["generate", "datasets", "--path", str(project), "--all-tables", "--check"])
    assert regenerate[-1] == {"tables": None, "exclude_tables": None}
    main(["generate", "datasets", "--path", str(project), "--exclude-tables", "x", "--check"])
    assert regenerate[-1] == {"tables": None, "exclude_tables": "x"}


def test_an_unrestricted_init_records_no_selection(
    tmp_path: Path, init_discovery: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project)]) == 0
    assert "selection" not in json.loads((project / "schema.json").read_text())
    calls: list[dict[str, Any]] = []

    def discover(**kwargs: Any) -> Schema:
        calls.append(kwargs)
        return _schema(None, ORDERS, CUSTOMERS)

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    main(["generate", "datasets", "--path", str(project), "--check"])
    # New tables keep appearing: nothing narrows an unrestricted project.
    assert calls == [{"tables": None, "exclude_tables": None}]


@pytest.mark.parametrize(
    "snapshot",
    [
        "not json",
        '{"selection": "orders"}',
        '{"selection": {"tables": 3}}',
        '{"selection": {}}',
        "[]",
    ],
)
def test_an_unusable_recorded_selection_is_ignored(snapshot: str, tmp_path: Path) -> None:
    from hypequery.cli.utils.recorded_selection import recorded_selection

    (tmp_path / "schema.json").write_text(snapshot)
    assert recorded_selection(tmp_path) is None


def test_all_tables_conflicts_with_a_selection() -> None:
    with pytest.raises(SystemExit) as exc:
        main(["generate", "datasets", "--all-tables", "--tables", "orders"])
    assert exc.value.code == 2


def test_tenant_hints_name_the_flag(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        "hypequery.cli.commands.generate.discover_schema", lambda **_: _schema(None, ORDERS)
    )
    main(["generate", "datasets", "--path", str(tmp_path)])
    assert "set tenant_key with `--tenant-column org_id`" in capsys.readouterr().out


def test_printed_paths_are_normalised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "a").mkdir()
    monkeypatch.chdir(tmp_path / "a")
    monkeypatch.setattr(
        "hypequery.cli.commands.generate.discover_schema", lambda **_: _schema(None, ORDERS)
    )
    main(["generate", "datasets", "--output", "../defs.py"])
    out = capsys.readouterr().out
    assert f"dataset definitions: {tmp_path.resolve() / 'defs.py'}" in out or (
        f"dataset definitions: {tmp_path / 'defs.py'}" in out
    )
    assert "/a/../" not in out


def test_a_selection_is_recorded_canonically_and_quoted(
    tmp_path: Path, init_discovery: list[dict[str, Any]]
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project), "--tables", " orders , customers "]) == 0
    selection = json.loads((project / "schema.json").read_text())["selection"]
    assert selection == {"tables": "orders,customers"}
    readme = (project / "README.md").read_text()
    assert "hypequery generate datasets --tables orders,customers --diff" in readme


def test_the_readme_command_is_shell_quoted() -> None:
    from hypequery.cli.generators.datasets import generate_datasets
    from hypequery.cli.generators.project import schema_templates
    from hypequery.cli.utils.templates import load_templates

    generated = generate_datasets(_schema(None, ORDERS), selection={"excludeTables": "a b"})
    readme = schema_templates(load_templates(), _schema(None, ORDERS), generated)["README.md"]
    assert "--exclude-tables 'a b' --diff" in readme


def test_output_elsewhere_still_uses_the_projects_selection(
    tmp_path: Path, init_discovery: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project), "--tables", "orders"]) == 0
    calls: list[dict[str, Any]] = []

    def discover(**kwargs: Any) -> Schema:
        calls.append(kwargs)
        return _schema(None, ORDERS)

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    monkeypatch.chdir(project)
    assert main(["generate", "datasets", "--output", "generated/definitions.py"]) == 0
    assert calls == [{"tables": "orders", "exclude_tables": None}]


def test_another_unrestricted_project_does_not_inherit_this_ones_selection(
    tmp_path: Path, init_discovery: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    restricted, unrestricted = tmp_path / "restricted", tmp_path / "unrestricted"
    assert main(["init", str(restricted), "--tables", "orders"]) == 0
    assert main(["init", str(unrestricted)]) == 0
    calls: list[dict[str, Any]] = []

    def discover(**kwargs: Any) -> Schema:
        calls.append(kwargs)
        return _schema(None, ORDERS, CUSTOMERS)

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    monkeypatch.chdir(restricted)
    main(["generate", "datasets", "--path", str(unrestricted), "--check"])
    assert calls == [{"tables": None, "exclude_tables": None}]


def test_regeneration_keeps_the_tenant_column_init_was_given(
    tmp_path: Path,
    init_discovery: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project), "--tenant-column", "org_id"]) == 0
    assert json.loads((project / "schema.json").read_text())["tenantColumn"] == "org_id"
    monkeypatch.setattr(
        "hypequery.cli.commands.generate.discover_schema",
        lambda **_: _schema(None, ORDERS, CUSTOMERS),
    )
    capsys.readouterr()
    # Without the flag, regeneration used to drop every tenant_key.
    assert main(["generate", "datasets", "--path", str(project), "--check"]) == 0
    out = capsys.readouterr().out
    assert "tenant column init recorded in schema.json (--tenant-column org_id)" in out
    assert "up to date" in out

    assert main(["generate", "datasets", "--path", str(project), "--no-tenant-column"]) == 1
    assert (
        main(["generate", "datasets", "--path", str(project), "--no-tenant-column", "--force"]) == 0
    )
    assert "tenant_key" not in (project / "datasets.py").read_text()
    assert "tenant_key" in capsys.readouterr().err


def test_an_unscoped_init_records_no_tenant_column(
    tmp_path: Path, init_discovery: list[dict[str, Any]]
) -> None:
    project = tmp_path / "app"
    assert main(["init", str(project)]) == 0
    assert "tenantColumn" not in json.loads((project / "schema.json").read_text())


def test_a_tampered_recorded_tenant_column_is_refused_before_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "schema.json").write_text('{"tenantColumn": "org id"}')
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "hypequery.cli.commands.generate.discover_schema", lambda **kwargs: calls.append(kwargs)
    )
    assert main(["generate", "datasets", "--path", str(tmp_path)]) == 1
    assert "identifier grammar" in capsys.readouterr().err
    assert calls == []


def test_tenant_column_and_no_tenant_column_conflict() -> None:
    with pytest.raises(SystemExit) as exc:
        main(["generate", "datasets", "--tenant-column", "org_id", "--no-tenant-column"])
    assert exc.value.code == 2
