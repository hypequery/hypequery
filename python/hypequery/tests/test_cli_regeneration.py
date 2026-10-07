"""Schema drift inspection and safe dataset replacement."""

from __future__ import annotations

import os
import runpy
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.errors import CliError
from hypequery.cli.generators.datasets import generate_datasets
from hypequery.cli.generators.schema import Column, Schema, Table
from hypequery.cli.utils.generated_file import GeneratedFile
from hypequery.cli.utils.tenant_settings import has_tenant_configuration


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


def test_tenant_refusal_happens_before_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "datasets.py"
    output.write_text('orders = dataset(tenant_key="tenant_id")\n')

    def fail(**_: object) -> None:
        pytest.fail("tenant refusal must not connect to ClickHouse")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    assert main(["generate", "datasets", "--output", str(output), "--force"]) == 1


@pytest.mark.parametrize(
    "source",
    [
        'orders = orders.model_copy(update={"tenant_key": "tenant_id"})\n',
        'orders.tenant_key = "tenant_id"\n',
        'orders = Dataset.model_validate({"tenant_key": "tenant_id"})\n',
        'settings["tenant_key"] = "tenant_id"\n',
        'setattr(orders, "tenant_key", "tenant_id")\n',
        # Setting names held in variables or built at runtime.
        'key = "tenant_key"\norders = Dataset.model_validate({**base, key: "tenant_id"})\n',
        'name = "tenant" + "_key"\norders = Dataset.model_validate({name: "tenant_id"})\n',
        "orders = Dataset(**settings)\n",
        'orders = getattr(Dataset, "model_" + "validate")(settings)\n',
        'orders = Dataset.model_validate_json(\'{"tenant_key": "tenant_id"}\')\n',
        "class Scoped(Dataset):\n    tenant_key: str | None = 'tenant_id'\n",
        "def scoped(tenant_key: str) -> None: ...\n",
        # Pre-configured definitions imported from project modules.
        "from tenancy import orders\n",
        "from .tenancy import orders\n",
        "import importlib\norders = importlib.import_module('tenancy').orders\n",
    ],
)
def test_indirect_tenant_configuration_detected(source: str) -> None:
    assert has_tenant_configuration(source)


def test_generated_definitions_are_replaceable(schema: Schema) -> None:
    assert not has_tenant_configuration(generate_datasets(schema).source)
    named = Schema(
        "analytics",
        (Table("tenant_key", (Column("tenant_key", "UInt64"), Column("id", "UInt64"))),),
    )
    assert not has_tenant_configuration(generate_datasets(named).source)


def test_stdlib_helpers_remain_replaceable(schema: Schema) -> None:
    source = "import os\n" + generate_datasets(schema).source
    assert not has_tenant_configuration(source)


def test_column_named_tenant_key_does_not_block_regeneration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def columns(*names: str) -> Schema:
        return Schema(
            "analytics",
            (Table("orders", tuple(Column(name, "String") for name in names)),),
        )

    output = tmp_path / "datasets.py"
    monkeypatch.setattr(
        "hypequery.cli.commands.generate.discover_schema", lambda **_: columns("tenant_key")
    )
    assert main(["generate", "datasets", "--output", str(output)]) == 0
    assert "column='tenant_key'" in output.read_text()
    assert not has_tenant_configuration(output.read_text())
    updated = columns("tenant_key", "status")
    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", lambda **_: updated)
    assert main(["generate", "datasets", "--output", str(output), "--force"]) == 0
    assert output.read_text() == generate_datasets(updated).source


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


def test_stale_lock_reports_owner(tmp_path: Path) -> None:
    path = tmp_path / "datasets.py"
    lock = tmp_path / ".datasets.py.lock"
    lock.mkdir()
    (lock / "pid").write_text("4242\n")
    with pytest.raises(CliError, match="process 4242"):
        GeneratedFile(path).write("# generated\n", overwrite=False)
    assert not path.exists()
    assert (lock / "pid").exists()


def test_discovery_failure_never_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "datasets.py"
    path.write_text("original")

    def fail(**_: object) -> Schema:
        raise CliError("Cannot inspect ClickHouse schema.")

    monkeypatch.setattr("hypequery.cli.commands.generate.discover_schema", fail)
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 1
    assert path.read_text() == "original"
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize(
    "settings",
    [
        '**{"tenant_key": "tenant_id"}',
        "**settings",
        'tenant_key="tenant_id"',
    ],
)
def test_valid_tenant_definitions_preserved(tmp_path: Path, schema: Schema, settings: str) -> None:
    path = tmp_path / "datasets.py"
    source = (
        "from hypequery.datasets import dataset, dimension, measure\n"
        'settings = {"tenant_key": "tenant_id"}\n'
        'orders = dataset(name="Orders", source="analytics.orders", '
        'dimensions={"tenantId": dimension.string(column="tenant_id"), '
        '"id": dimension.number(column="id")}, '
        'measures={"totalCount": measure.count("rows", sql="1")}, '
        f"{settings})\n"
    )
    path.write_text(source)
    assert runpy.run_path(str(path))["orders"].tenant_key == "tenant_id"
    assert main(["generate", "datasets", "--output", str(path), "--force"]) == 1
    assert path.read_text() == source


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
