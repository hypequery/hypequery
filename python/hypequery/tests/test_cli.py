"""The CLI contract is independent of serving and driver extras."""

from __future__ import annotations

import shutil
import subprocess
import sys
from importlib.metadata import version

import pytest

from hypequery.cli import main
from hypequery.cli.parser import parse_args


@pytest.mark.parametrize("args", [["--help"], ["init", "--help"], ["dev", "--help"]])
def test_help_does_not_import_optional_packages(args: list[str]) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
from hypequery.cli import main
try:
    main(sys.argv[1:])
except SystemExit as exc:
    assert exc.code == 0
assert not {'fastapi', 'starlette', 'uvicorn', 'clickhouse_connect'} & sys.modules.keys()
""",
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "usage: hypequery" in result.stdout


def test_console_and_module_version_match_distribution() -> None:
    executable = shutil.which("hypequery")
    assert executable is not None
    for entry in ([executable], [sys.executable, "-m", "hypequery"]):
        result = subprocess.run([*entry, "--version"], capture_output=True, text=True, check=False)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == f"hypequery {version('hypequery')}"


@pytest.mark.parametrize("args", [[], ["unknown"], ["dev", "--port", "0"], ["init", "--bad"]])
def test_usage_errors(args: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(args)
    assert exc.value.code == 2
    assert "Traceback" not in capsys.readouterr().err


def test_dev_argument_contract() -> None:
    args = parse_args(["dev"])
    assert (args.app, args.host, args.port, args.reload) == ("app:app", "127.0.0.1", 8000, True)
    assert parse_args(["dev", "--no-reload"]).reload is False
