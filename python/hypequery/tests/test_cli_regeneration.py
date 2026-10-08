"""Schema drift inspection and safe dataset replacement."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from hypequery.cli import main
from hypequery.cli.errors import CliError
from hypequery.cli.generators.datasets import generate_datasets
from hypequery.cli.generators.schema import Column, Schema, Table
from hypequery.cli.utils.generated_file import GeneratedFile
from hypequery.cli.utils.tenant_settings import configures_tenant
from hypequery.datasets import Dataset


@pytest.fixture
def schema(monkeypatch: pytest.MonkeyPatch) -> Schema:
    value = Schema("analytics", (Table("orders", (Column("id", "UInt64"),)),))
    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", lambda **_: value)
    return value


def test_create_check_and_diff_are_repeatable(
    tmp_path: Path, schema: Schema, capsys: pytest.CaptureFixture[str]
) -> None:
    output = tmp_path / "analytics" / "datasets.py"
    args = ["generate", "datasets", "--output", str(output)]
    assert main([*args, "--check"]) == 1
    assert not output.parent.exists()
    assert main([*args, "--diff"]) == 1
    assert not output.parent.exists()
    assert "+from hypequery.datasets" in capsys.readouterr().out
    assert main(args) == 0
    original = output.stat()
    assert output.read_text() == generate_datasets(schema).source
    for flag in ([], ["--check"], ["--diff"], ["--force"]):
        assert main([*args, *flag]) == 0
        assert output.stat().st_mtime_ns == original.st_mtime_ns
    output.write_text("# authored note\n" + output.read_text())
    authored = output.read_bytes()
    for flag in ([], ["--check"], ["--diff"]):
        assert main([*args, *flag]) == 1
        assert output.read_bytes() == authored
    assert main([*args, "--force"]) == 0
    assert output.read_text() == generate_datasets(schema).source


def test_default_and_directory_paths(
    tmp_path: Path, schema: Schema, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["generate", "datasets"]) == 0
    # init places datasets.py beside app.py, so the default must match that layout.
    assert (tmp_path / "datasets.py").read_text() == generate_datasets(schema).source
    assert main(["generate:datasets", "--check"]) == 0
    assert main(["generate", "datasets", "--path", "project"]) == 0
    assert (tmp_path / "project" / "datasets.py").exists()


@pytest.mark.parametrize(
    "settings",
    ['tenant_key="tenant_id"', '**{"tenant_key": "tenant_id"}', "**settings"],
)
def test_force_replaces_tenant_definitions_with_warning(
    tmp_path: Path, schema: Schema, capsys: pytest.CaptureFixture[str], settings: str
) -> None:
    path = tmp_path / "datasets.py"
    path.write_text(
        'settings = {"tenant_key": "tenant_id"}\n'
        f'orders = dataset(name="orders", source="analytics.orders", {settings})\n'
    )
    args = ["generate", "datasets", "--output", str(path)]
    assert main(args) == 1
    assert main([*args, "--force"]) == 0
    assert path.read_text() == generate_datasets(schema).source
    assert "tenant_key" in capsys.readouterr().err


def test_force_without_tenant_settings_does_not_warn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A physical table or column named tenant_key is not a tenant setting.
    def columns(*names: str) -> Schema:
        return Schema(
            "analytics",
            (Table("tenant_key", tuple(Column(name, "String") for name in names)),),
        )

    path = tmp_path / "datasets.py"
    path.write_text(generate_datasets(columns("tenant_key")).source)
    assert not configures_tenant(path.read_text())
    updated = columns("tenant_key", "status")
    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", lambda **_: updated)
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 0
    assert path.read_text() == generate_datasets(updated).source
    assert "tenant_key" not in capsys.readouterr().err


def test_selection_and_invalid_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, schema: Schema
) -> None:
    calls = []

    def discover(**kwargs: str | None) -> Schema:
        calls.append(kwargs)
        return schema

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    assert (
        main(
            [
                "generate",
                "datasets",
                "--path",
                str(tmp_path),
                "--tables",
                "orders",
                "--exclude-tables",
                "events",
            ]
        )
        == 0
    )
    assert calls == [{"tables": "orders", "exclude_tables": "events"}]
    for flag in ("--check", "--diff"):
        with pytest.raises(SystemExit) as exc:
            main(["generate", "datasets", "--force", flag])
        assert exc.value.code == 2
    assert len(calls) == 1


def test_output_symlinks_refused_before_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "real"
    destination.mkdir()
    link = tmp_path / "link"
    link.symlink_to(destination, target_is_directory=True)

    def fail(**_: object) -> None:
        pytest.fail("unsafe output must be refused before connecting")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    assert main(["generate", "datasets", "--path", str(link)]) == 1
    assert not list(destination.iterdir())


def test_exclusive_create_preserves_competing_file(tmp_path: Path) -> None:
    path = tmp_path / "datasets.py"
    file = GeneratedFile(path)
    assert file.read() is None
    path.write_text("concurrent writer")
    with pytest.raises(CliError, match="changed since discovery"):
        file.write("generated", overwrite=False)
    assert path.read_text() == "concurrent writer"
    assert list(tmp_path.iterdir()) == [path]


def test_failed_replacement_keeps_original(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")
    path.chmod(0o400)

    def fail(*_: object) -> None:
        raise OSError("filesystem unavailable")

    monkeypatch.setattr(os, "replace", fail)
    with pytest.raises(CliError, match="Cannot write"):
        GeneratedFile(path).write("replacement", overwrite=True)
    assert path.read_text() == "original"
    assert path.stat().st_mode & 0o777 == 0o400
    assert list(tmp_path.iterdir()) == [path]


def test_replacement_does_not_widen_permissions(tmp_path: Path) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")
    path.chmod(0o400)
    GeneratedFile(path).write("replacement", overwrite=True)
    assert path.read_text() == "replacement"
    assert path.stat().st_mode & 0o777 == 0o400


def test_replacement_preserves_shared_read_permissions(tmp_path: Path) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")
    path.chmod(0o644)
    GeneratedFile(path).write("replacement", overwrite=True)
    assert path.stat().st_mode & 0o777 == 0o644


def test_new_file_uses_umask_default(tmp_path: Path) -> None:
    previous = os.umask(0o022)
    try:
        GeneratedFile(tmp_path / "datasets.py").write("# generated\n", overwrite=False)
    finally:
        os.umask(previous)
    assert (tmp_path / "datasets.py").stat().st_mode & 0o777 == 0o644


def test_create_without_hard_links(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def unsupported(*_: object) -> None:
        raise PermissionError("hard links unsupported")

    monkeypatch.setattr(os, "link", unsupported)
    path = tmp_path / "datasets.py"
    GeneratedFile(path).write("# generated\n", overwrite=False)
    assert path.read_text() == "# generated\n"
    assert list(tmp_path.iterdir()) == [path]


def test_held_lock_reports_running_owner(tmp_path: Path) -> None:
    path = tmp_path / "datasets.py"
    lock = tmp_path / ".datasets.py.lock"
    lock.mkdir()
    (lock / "pid").write_text(f"{os.getpid()}\n")
    with pytest.raises(CliError, match=f"Another generator \\(process {os.getpid()}\\)"):
        GeneratedFile(path).write("# generated\n", overwrite=False)
    assert not path.exists()
    assert (lock / "pid").exists()


def test_stale_lock_names_stopped_owner_without_reclaiming(tmp_path: Path) -> None:
    finished = subprocess.run(
        [sys.executable, "-c", "import os; print(os.getpid())"],
        capture_output=True,
        text=True,
        check=True,
    )
    pid = int(finished.stdout)
    path = tmp_path / "datasets.py"
    lock = tmp_path / ".datasets.py.lock"
    lock.mkdir()
    (lock / "pid").write_text(f"{pid}\n")
    with pytest.raises(CliError, match=f"process {pid}\\) stopped without releasing"):
        GeneratedFile(path).write("# generated\n", overwrite=False)
    # Reclaiming would race other generators; the user removes the lock.
    assert not path.exists()
    assert (lock / "pid").read_text() == f"{pid}\n"


def test_discovery_failure_never_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")

    def fail(**_: object) -> Schema:
        raise CliError("Cannot inspect ClickHouse schema.")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 1
    assert path.read_text() == "original"
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("exists", [True, False])
def test_changes_during_discovery_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, schema: Schema, exists: bool
) -> None:
    path = tmp_path / "datasets.py"
    if exists:
        path.write_text("# original definitions\n")
    replacement = 'orders = dataset(tenant_key="tenant_id")\n'

    def discover(**_: object) -> Schema:
        path.write_text(replacement)
        return schema

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 1
    assert path.read_text() == replacement
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("flag", [[], ["--check"], ["--diff"]])
def test_read_only_results_recheck_after_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, schema: Schema, flag: list[str]
) -> None:
    path = tmp_path / "datasets.py"
    path.write_text(generate_datasets(schema).source)
    edited = "# edited during discovery\n" + path.read_text()

    def discover(**_: object) -> Schema:
        path.write_text(edited)
        return schema

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", discover)
    assert main(["generate", "datasets", "--output", str(path), *flag]) == 1
    assert path.read_text() == edited
    assert list(tmp_path.iterdir()) == [path]


def test_read_only_recheck_never_creates_directories(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, schema: Schema
) -> None:
    output = tmp_path / "missing" / "datasets.py"
    for flag in ("--check", "--diff"):
        assert main(["generate", "datasets", "--output", str(output), flag]) == 1
    assert not output.parent.exists()


def test_changes_during_temporary_write_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("# original\n")
    output = GeneratedFile(path)
    output.read()
    fsync = os.fsync

    def concurrent_write(fd: int) -> None:
        path.write_text('orders = dataset(tenant_key="tenant_id")\n')
        fsync(fd)

    monkeypatch.setattr(os, "fsync", concurrent_write)
    with pytest.raises(CliError, match="changed since discovery"):
        output.write("# replacement\n", overwrite=True)
    assert "tenant_key" in path.read_text()
    assert list(tmp_path.iterdir()) == [path]


def test_cli_lock_protects_validation_through_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("# original\n")
    competing = GeneratedFile(path)
    competing.read()
    replace = os.replace

    def concurrent_writer(source: Path, destination: Path) -> None:
        with pytest.raises(CliError, match="Another generator"):
            competing.write("# competing\n", overwrite=True)
        replace(source, destination)

    monkeypatch.setattr(os, "replace", concurrent_writer)
    GeneratedFile(path).write("# replacement\n", overwrite=True)
    assert path.read_text() == "# replacement\n"
    assert list(tmp_path.iterdir()) == [path]


def test_parent_created_by_competing_generator_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = tmp_path / "shared"
    mkdir = Path.mkdir

    def concurrent_parent(
        path: Path, mode: int = 0o777, parents: bool = False, exist_ok: bool = False
    ) -> None:
        if path == parent and not path.exists():
            mkdir(path)
            (path / "other.py").write_text("# other generator\n")
            raise FileExistsError
        mkdir(path, mode=mode, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(Path, "mkdir", concurrent_parent)
    GeneratedFile(parent / "datasets.py").write("# generated\n", overwrite=False)
    assert (parent / "datasets.py").read_text() == "# generated\n"
    assert (parent / "other.py").exists()


def _use_schema(monkeypatch: pytest.MonkeyPatch, schema: Schema) -> None:
    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", lambda **_: schema)


def _load(path: Path) -> dict[str, object]:
    namespace: dict[str, object] = {}
    exec(compile(path.read_text(), str(path), "exec"), namespace)  # noqa: S102 - generated file
    return cast(dict[str, object], namespace["datasets"])


def test_tenant_column_sets_tenant_key_and_reports_tables_without_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _use_schema(
        monkeypatch,
        Schema(
            "analytics",
            (
                Table("orders", (Column("id", "UInt64"), Column("tenant_id", "String"))),
                Table("events", (Column("id", "UInt64"), Column("org_id", "String"))),
            ),
        ),
    )
    path = tmp_path / "datasets.py"
    args = ["generate", "datasets", "--output", str(path), "--tenant-column", "tenant_id"]
    assert main(args) == 0
    datasets = _load(path)
    assert cast(Dataset, datasets["orders"]).tenant_key == "tenant_id"
    assert cast(Dataset, datasets["events"]).tenant_key is None
    out = capsys.readouterr().out
    assert "events: no 'tenant_id' column, so tenant isolation was not applied" in out
    # The configured column is policy, not a candidate to review.
    assert "orders: possible tenant columns" not in out
    assert "events: possible tenant columns org_id" in out
    assert main([*args, "--check"]) == 0
    assert main(["generate", "datasets", "--output", str(path), "--check"]) == 1


def test_force_with_tenant_column_keeps_boundary_without_warning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _use_schema(
        monkeypatch,
        Schema(
            "analytics", (Table("orders", (Column("id", "UInt64"), Column("tenant_id", "String"))),)
        ),
    )
    path = tmp_path / "datasets.py"
    path.write_text(
        'orders = dataset(name="orders", source="analytics.orders", tenant_key="tenant_id")\n'
    )
    args = ["generate", "datasets", "--output", str(path), "--force"]
    assert main([*args, "--tenant-column", "tenant_id"]) == 0
    assert "tenant_key='tenant_id'" in path.read_text()
    assert "Warning" not in capsys.readouterr().err
    # Without the option the regenerated file drops the boundary, so it warns.
    assert main(args) == 0
    assert "configured tenant_key" in capsys.readouterr().err


def test_invalid_tenant_column_refused_before_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def fail(**_: object) -> None:
        pytest.fail("an invalid tenant column must be refused before connecting")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    path = tmp_path / "datasets.py"
    assert main(["generate", "datasets", "--output", str(path), "--tenant-column", "a;b"]) == 1
    assert "tenant column" in capsys.readouterr().err
    assert not path.exists()


def test_tenant_candidates_are_reported_but_never_enabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _use_schema(
        monkeypatch,
        Schema(
            "analytics",
            (
                Table(
                    "orders",
                    (
                        Column("id", "UInt64"),
                        Column("organization_id", "String"),
                        Column("customer_id", "String"),
                    ),
                ),
            ),
        ),
    )
    path = tmp_path / "datasets.py"
    assert main(["generate", "datasets", "--output", str(path)]) == 0
    assert "Review: orders: possible tenant columns organization_id, customer_id" in (
        capsys.readouterr().out
    )
    assert "tenant_key" not in path.read_text()


@pytest.mark.parametrize(
    ("tables", "expected"), [(("orders",), "1 table"), (("orders", "events"), "2 tables")]
)
def test_reports_number_of_tables_generated(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tables: tuple[str, ...],
    expected: str,
) -> None:
    _use_schema(
        monkeypatch,
        Schema("analytics", tuple(Table(name, (Column("id", "UInt64"),)) for name in tables)),
    )
    assert main(["generate", "datasets", "--output", str(tmp_path / "datasets.py")]) == 0
    assert f"Generated dataset definitions for {expected}\n" in capsys.readouterr().out


def test_connection_failures_redact_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    clickhouse_connect = pytest.importorskip("clickhouse_connect")
    secret = "s3cret-generate-password"  # noqa: S105 - test value
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", secret)
    monkeypatch.setenv("CLICKHOUSE_USERNAME", "secret-user")

    def refuse(**kwargs: object) -> None:
        raise ConnectionError(f"auth failed for {kwargs['username']}:{kwargs['password']}")

    monkeypatch.setattr(clickhouse_connect, "get_client", refuse)
    path = tmp_path / "datasets.py"
    assert main(["generate", "datasets", "--output", str(path)]) == 1
    captured = capsys.readouterr()
    assert "Cannot inspect ClickHouse" in captured.err
    assert secret not in captured.out + captured.err
    assert "secret-user" not in captured.out + captured.err
    assert not path.exists()
