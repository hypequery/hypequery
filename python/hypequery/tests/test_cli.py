"""The CLI contract is independent of serving and driver extras."""

from __future__ import annotations

import shutil
import subprocess
import sys
from importlib.metadata import version

import pytest

from hypequery.cli import main
from hypequery.cli.options import DevOptions, InitOptions
from hypequery.cli.parser import parse_args


@pytest.mark.parametrize(
    "args",
    [
        ["--help"],
        ["init", "--help"],
        ["dev", "--help"],
        ["help"],
        ["help", "init"],
        ["help", "dev"],
    ],
)
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


@pytest.mark.parametrize("command", ["init", "dev"])
def test_dispatches_parsed_arguments(monkeypatch: pytest.MonkeyPatch, command: str) -> None:
    from types import SimpleNamespace

    imported: list[str] = []
    received: list[object] = []

    def import_command(name: str) -> SimpleNamespace:
        imported.append(name)
        return SimpleNamespace(run=received.append)

    monkeypatch.setattr("hypequery.cli.import_module", import_command)
    assert main([command]) == 0
    assert imported == [f"hypequery.cli.commands.{command}"]
    assert len(received) == 1
    # Commands receive typed options, never the untyped argparse namespace.
    expected = {"init": InitOptions, "dev": DevOptions}[command]
    assert type(received[0]) is expected


@pytest.mark.parametrize("command", ["init", "dev"])
def test_dispatch_runtime_failure_is_stderr_and_status_one(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    command: str,
) -> None:
    from types import SimpleNamespace

    from hypequery.cli.errors import CliError

    def fail(args: object) -> None:
        raise CliError("safe actionable failure")

    monkeypatch.setattr("hypequery.cli.import_module", lambda name: SimpleNamespace(run=fail))
    assert main([command]) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err.strip() == "hypequery: safe actionable failure"


@pytest.mark.parametrize("flag", ["--hostname", "--host"])
def test_hostname_spellings(flag: str) -> None:
    assert parse_args(["dev", flag, "localhost", "-p", "9000"]).host == "localhost"
    assert parse_args(["dev", flag, "localhost", "-p", "9000"]).port == 9000


@pytest.mark.parametrize("flag", ["--no-watch", "--no-reload"])
def test_disable_watch_spellings(flag: str) -> None:
    assert parse_args(["dev", flag]).reload is False


@pytest.mark.parametrize("args", [["init", "example"], ["init", "--path", "example"]])
def test_init_destination_spellings(args: list[str]) -> None:
    assert parse_args(args).directory == "example"


def test_init_rejects_ambiguous_destination() -> None:
    with pytest.raises(SystemExit) as exc:
        parse_args(["init", "one", "--path", "two"])
    assert exc.value.code == 2


def test_typescript_version_short_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        parse_args(["-V"])
    assert exc.value.code == 0
    assert capsys.readouterr().out.strip() == f"hypequery {version('hypequery')}"
