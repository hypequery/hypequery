"""Offline export entry point, deterministic output and safe project/file boundaries."""

from __future__ import annotations

import json
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from hypequery.cli.parser import parse_args
from hypequery.protocol import validate_protocol_client_contract

FACTORY = """
import sys
import logging
print("PROJECT_SECRET_CHATTER")
print("PROJECT_SECRET_CHATTER", file=sys.stderr)
logging.warning("PROJECT_SECRET_CHATTER")
from hypequery.datasets import ClientEndpointDefinition, ClientQueryProfile, Dataset
from hypequery.datasets import dimension, export_client_contract

def build():
    print("PROJECT_SECRET_CHATTER")
    assert not {"fastapi", "starlette", "uvicorn", "clickhouse_connect"} & sys.modules.keys()
    definition = Dataset(
        name="orders", source="PHYSICAL_SECRET",
        dimensions={"country": dimension.string()},
    )
    return export_client_contract([
        ClientEndpointDefinition(definition, "/orders", ClientQueryProfile())
    ])
"""


def run_cli(directory: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "hypequery", *args],
        cwd=directory,
        capture_output=True,
        text=True,
        check=False,
    )


def prepare(directory: Path, source: str = FACTORY) -> None:
    (directory / "contract_factory.py").write_text(source)


def test_stdout_is_only_verified_canonical_json_without_optional_extras(tmp_path: Path) -> None:
    prepare(tmp_path)
    result = run_cli(
        tmp_path, "export", "client-contract", "--factory", "contract_factory:build", "--stdout"
    )
    assert result.returncode == 0, result.stderr
    contract = validate_protocol_client_contract(json.loads(result.stdout))
    assert contract["endpoints"][0]["id"] == "orders"
    assert result.stderr == ""
    assert "PROJECT_SECRET_CHATTER" not in result.stdout
    assert "PHYSICAL_SECRET" not in result.stdout
    assert sorted(path.name for path in tmp_path.iterdir()) == ["contract_factory.py"]


def test_file_export_check_force_and_permissions(tmp_path: Path) -> None:
    prepare(tmp_path)
    arguments = ("export", "client-contract", "--factory", "contract_factory:build")
    initial = run_cli(tmp_path, *arguments)
    output = tmp_path / "client-contract.json"
    assert initial.returncode == 0, initial.stderr
    original = output.read_text()
    assert run_cli(tmp_path, *arguments, "--check").returncode == 0
    output.write_text("stale")
    output.chmod(0o600)
    assert run_cli(tmp_path, *arguments).returncode == 1
    assert output.read_text() == "stale"
    assert run_cli(tmp_path, *arguments, "--check").returncode == 1
    assert output.read_text() == "stale"
    assert run_cli(tmp_path, *arguments, "--force").returncode == 0
    assert output.read_text() == original
    assert stat.S_IMODE(output.stat().st_mode) == 0o600


def test_check_missing_output_creates_no_directories(tmp_path: Path) -> None:
    prepare(tmp_path)
    result = run_cli(
        tmp_path,
        "export",
        "client-contract",
        "--factory",
        "contract_factory:build",
        "--output",
        "missing/client.json",
        "--check",
    )
    assert result.returncode == 1
    assert not (tmp_path / "missing").exists()


@pytest.mark.parametrize(
    "source",
    [
        "raise RuntimeError('FACTORY_SECRET')",
        "raise SystemExit('FACTORY_SECRET')",
        "def build():\n    raise RuntimeError('FACTORY_SECRET')",
        "def build():\n    raise SystemExit('FACTORY_SECRET')",
        "def build(required):\n    return required",
        "build = 4",
        "FACTORY_SECRET = + invalid syntax",
    ],
)
def test_factory_failures_are_redacted_and_do_not_write(tmp_path: Path, source: str) -> None:
    prepare(tmp_path, source)
    result = run_cli(tmp_path, "export", "client-contract", "--factory", "contract_factory:build")
    assert result.returncode == 1
    assert "FACTORY_SECRET" not in result.stdout + result.stderr
    assert "Traceback" not in result.stderr
    assert not (tmp_path / "client-contract.json").exists()


@pytest.mark.parametrize(
    "change",
    [
        'value["canonical"] = "WRAPPER_SECRET"',
        'value["contentHash"] = "WRAPPER_SECRET"',
        'value["contract"]["contentHash"] = "WRAPPER_SECRET"',
        'value["secret"] = "WRAPPER_SECRET"',
    ],
)
def test_supplied_root_and_prepared_identities_are_verified(tmp_path: Path, change: str) -> None:
    source = (
        FACTORY.replace("def build():", "def original():")
        + """
def build():
    value = original()
    CHANGE
    return value
""".replace("CHANGE", change)
    )
    prepare(tmp_path, source)
    result = run_cli(
        tmp_path, "export", "client-contract", "--factory", "contract_factory:build", "--stdout"
    )
    assert result.returncode == 1
    assert "WRAPPER_SECRET" not in result.stdout + result.stderr
    assert not (tmp_path / "client-contract.json").exists()


def test_unsafe_or_oversized_destination_is_rejected_before_import(tmp_path: Path) -> None:
    prepare(tmp_path, 'from pathlib import Path\nPath("imported").touch()\ndef build(): return {}')
    output = tmp_path / "artifact.json"
    output.write_bytes(b"x" * 1_048_577)
    result = run_cli(
        tmp_path,
        "export",
        "client-contract",
        "--factory",
        "contract_factory:build",
        "--output",
        "artifact.json",
        "--force",
    )
    assert result.returncode == 1
    assert "byte budget" in result.stderr
    assert not (tmp_path / "imported").exists()
    output.unlink()
    output.symlink_to(tmp_path / "other.json")
    result = run_cli(
        tmp_path,
        "export",
        "client-contract",
        "--factory",
        "contract_factory:build",
        "--output",
        "artifact.json",
        "--force",
    )
    assert result.returncode == 1
    assert "symlinks" in result.stderr
    assert not (tmp_path / "imported").exists()


def test_concurrent_destination_changes_are_preserved(tmp_path: Path) -> None:
    prepare(
        tmp_path,
        FACTORY.replace(
            "    return export_client_contract(",
            "    from pathlib import Path\n"
            '    Path("artifact.json").write_text("concurrent")\n'
            "    return export_client_contract(",
        ),
    )
    output = tmp_path / "artifact.json"
    output.write_text("old")
    result = run_cli(
        tmp_path,
        "export",
        "client-contract",
        "--factory",
        "contract_factory:build",
        "--output",
        "artifact.json",
        "--force",
    )
    assert result.returncode == 1
    assert output.read_text() == "concurrent"


@pytest.mark.parametrize(
    "extra",
    [
        ["--stdout", "--check"],
        ["--output", "-", "--force"],
        ["--check", "--force"],
        ["--stdout", "--output", "a.json"],
    ],
)
def test_conflicting_export_flags_are_usage_errors(extra: list[str]) -> None:
    with pytest.raises(SystemExit) as failure:
        parse_args(["export", "client-contract", "--factory", "contract_factory:build", *extra])
    assert failure.value.code == 2


def test_output_dash_is_stdout_and_signed_root_factory_is_supported(tmp_path: Path) -> None:
    prepare(
        tmp_path,
        FACTORY.replace("def build():", "def original():")
        + """
def build():
    return original()["contract"]
""",
    )
    result = run_cli(
        tmp_path,
        "export",
        "client-contract",
        "--factory",
        "contract_factory:build",
        "--output",
        "-",
    )
    assert result.returncode == 0, result.stderr
    assert validate_protocol_client_contract(json.loads(result.stdout))["view"] == "build"
    assert not (tmp_path / "-").exists()


def test_factory_loader_restores_process_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import logging

    from hypequery.cli.utils.client_contract_factory import load_client_contract_factory

    source = """
import sys
import logging
from hypequery.datasets import export_client_contract
logging.root.addHandler(logging.StreamHandler(sys.stderr))
print("TEMPORARY_CHATTER")
def build():
    return export_client_contract([])
"""
    (tmp_path / "restore_factory.py").write_text(source)
    monkeypatch.chdir(tmp_path)
    previous_path = list(sys.path)
    previous_bytecode = sys.dont_write_bytecode
    previous_out, previous_err = sys.stdout, sys.stderr
    previous_handlers = list(logging.root.handlers)
    previous_disable = logging.root.manager.disable
    artifact = load_client_contract_factory("restore_factory:build")
    assert json.loads(artifact)["endpoints"] == []
    assert sys.path == previous_path
    assert sys.dont_write_bytecode == previous_bytecode
    assert sys.stdout is previous_out
    assert sys.stderr is previous_err
    assert logging.root.handlers == previous_handlers
    assert logging.root.manager.disable == previous_disable
