"""Schema drift inspection and safe dataset replacement."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.errors import CliError
from hypequery.cli.generators.datasets import generate_datasets
from hypequery.cli.generators.schema import Column, Schema, Table
from hypequery.cli.utils.generated_file import GeneratedFile


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
    assert (tmp_path / "analytics" / "datasets.py").read_text() == generate_datasets(schema).source
    assert main(["generate", "datasets", "--path", "project"]) == 0
    assert (tmp_path / "project" / "datasets.py").exists()


def test_tenant_boundary_cannot_be_erased(tmp_path: Path, schema: Schema) -> None:
    output = tmp_path / "datasets.py"
    authored = 'configured = dataset(name="orders", tenant_key="tenant_id")\n'
    output.write_text(authored)
    assert main(["generate", "datasets", "--output", str(output), "--force"]) == 1
    assert output.read_text() == authored


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
    with pytest.raises(CliError, match="Refusing to overwrite"):
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


def test_discovery_failure_never_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")

    def fail(**_: object) -> Schema:
        raise CliError("Cannot inspect ClickHouse schema.")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 1
    assert path.read_text() == "original"
    assert list(tmp_path.iterdir()) == [path]
