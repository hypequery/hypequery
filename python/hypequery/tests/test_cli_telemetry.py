"""CLI telemetry: one validated event per invocation, shared settings, never blocking."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

from hypequery.cli.telemetry.catalog import COMPLETED_EVENT, validate_event
from hypequery.cli.telemetry.invocation import (
    flags_used,
    has_unknown_option,
    help_topic,
    requested_command,
    suggested_command,
)
from hypequery.cli.telemetry.lifecycle import CommandTelemetry, duration_bucket
from hypequery.cli.telemetry.opt_out import opt_out_source, resolve_state
from hypequery.cli.telemetry.project import normalize_remote, project_id
from hypequery.cli.telemetry.settings import PYTHON_KILL_SWITCH, SettingsStore, config_directory
from hypequery.cli.telemetry.settings_lock import acquire_settings_lock

INSTALL_ID = "0f9c6f1e-6a52-4c7e-9d0a-3b8f2e4d5c61"


def _clean_env(config: Path, **extra: str) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "PYTEST_CURRENT_TEST",
            "DO_NOT_TRACK",
            "HYPEQUERY_TELEMETRY_DISABLED",
            "HYPEQUERY_TELEMETRY_URL",
            "HYPEQUERY_TELEMETRY_DEBUG",
            "GITHUB_ACTIONS",
            "CI",
        }
    }
    return {**env, "HYPEQUERY_CONFIG_DIR": str(config), **extra}


def _run(args: list[str], env: dict[str, str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "hypequery", *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        check=False,
        timeout=60,
    )


def _events(stderr: str) -> list[dict[str, Any]]:
    events = []
    for line in stderr.splitlines():
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict) and "event" in parsed:
            events.append(parsed)
    return events


@pytest.mark.parametrize(
    ("argv", "command"),
    [
        ([], "help"),
        (["--help"], "help"),
        (["-V"], "version"),
        (["init", "--bogus"], "init"),
        (["init", "--path", "--help-is-a-directory"], "init"),
        (["dev", "--help"], "help"),
        (["generate", "datasets", "--check"], "generate:datasets"),
        (["generate:datasets"], "generate:datasets"),
        (["export", "client-contract", "--factory", "a:b"], "export:client-contract"),
        (["--no-telemetry", "telemetry", "status"], "telemetry"),
        (["PRIVATE-command"], "unknown"),
        (["--version", "init"], "version"),
        (["-V", "dev", "--port", "1"], "version"),
        (["--help", "init"], "help"),
        (["init", "--path", "--version"], "init"),
    ],
)
def test_commands_are_attributed_from_argv(argv: list[str], command: str) -> None:
    assert requested_command(argv) == command


def test_flags_are_canonical_names_and_values_are_never_read() -> None:
    argv = ["dev", "-p", "9000", "--host", "PRIVATE", "--no-reload", "--no-telemetry"]
    assert flags_used("dev", argv) == ["--hostname", "--no-telemetry", "--no-watch", "--port"]
    assert flags_used("init", ["init", "--tables", "--force", "--framework=django"]) == [
        "--framework",
        "--tables",
    ]
    assert flags_used("unknown", ["x", "--tables", "a"]) == []
    assert has_unknown_option("init", ["init", "--bogus"])
    assert not has_unknown_option("dev", ["dev", "--port", "-1"])
    assert not has_unknown_option("dev", ["dev", "app:app", "--", "--bogus"])
    assert not has_unknown_option("init", ["init", "--path", "out", "--no-telemetry"])


def test_help_topics_and_suggestions_are_known_commands_only() -> None:
    assert help_topic(["help", "dev"]) == "dev"
    assert help_topic(["export", "client-contract", "--help"]) == "export:client-contract"
    assert help_topic(["help", "PRIVATE"]) == "root"
    assert help_topic(["help", "telemetry"]) == "telemetry"
    assert help_topic(["--help", "init"]) == "root"
    assert suggested_command(["genrate"]) == "generate:datasets"
    assert suggested_command(["PRIVATE-command"]) is None


def test_duration_buckets() -> None:
    assert [duration_bucket(s) for s in (0.01, 0.5, 5, 30, 300, 3000, 9000)] == [
        "<100ms",
        "100ms-1s",
        "1s-10s",
        "10s-1m",
        "1m-10m",
        "10m-1h",
        "1h+",
    ]


def test_opt_outs_win_in_order_and_never_create_settings(tmp_path: Path) -> None:
    env = _clean_env(tmp_path)
    assert opt_out_source(env, flag_disabled=True) == "flag"
    assert opt_out_source({**env, "DO_NOT_TRACK": "1"}, flag_disabled=False) == "DO_NOT_TRACK"
    assert opt_out_source({**env, "PYTEST_CURRENT_TEST": "x"}, flag_disabled=False) == "test"
    ci = {**env, "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Hypequery/Hypequery"}
    assert opt_out_source(ci, flag_disabled=False) == "hypequery_ci"
    assert opt_out_source({**env, "CI": "1"}, flag_disabled=False) is None
    state = resolve_state({**env, "DO_NOT_TRACK": "1"}, flag_disabled=False, cli_version="0.1.0")
    assert (state.enabled, state.settings) == (False, None)
    assert not (tmp_path / "telemetry.json").exists()


def test_config_directory_matches_the_typescript_cli(tmp_path: Path) -> None:
    home = str(tmp_path)
    assert config_directory({"HOME": home}, "darwin") == Path(
        home, "Library", "Application Support", "hypequery"
    )
    assert config_directory({"HOME": home}, "linux") == Path(home, ".config", "hypequery")
    assert config_directory({"HOME": home, "XDG_CONFIG_HOME": "/x"}, "linux") == Path(
        "/x", "hypequery"
    )
    assert config_directory({"APPDATA": "C:/AppData"}, "win32") == Path("C:/AppData", "hypequery")
    assert config_directory({"HOME": str(tmp_path / "missing")}, "linux") is None


def test_settings_are_shared_and_typescript_keys_survive_writes(tmp_path: Path) -> None:
    written_by_typescript = {
        "schema_version": 1,
        "install_id": INSTALL_ID,
        "enabled": True,
        "notice_shown_at": "2026-01-01T00:00:00.000Z",
        "disabled_cli_versions": ["1.2.3"],
    }
    (tmp_path / "telemetry.json").write_text(json.dumps(written_by_typescript))
    store = SettingsStore({"HYPEQUERY_CONFIG_DIR": str(tmp_path)})
    assert store.load() is not None
    assert store.load().install_id == INSTALL_ID  # type: ignore[union-attr]
    store.disable_version("0.1.0b2")
    disabled = store.set_enabled(False)
    assert disabled is not None
    saved = json.loads((tmp_path / "telemetry.json").read_text())
    assert saved == {**written_by_typescript, "enabled": False, PYTHON_KILL_SWITCH: ["0.1.0b2"]}
    assert list(tmp_path.iterdir()) == [tmp_path / "telemetry.json"]


def test_settings_fail_closed_on_malformed_files(tmp_path: Path) -> None:
    (tmp_path / "telemetry.json").write_text('{"schema_version": 2}')
    store = SettingsStore({"HYPEQUERY_CONFIG_DIR": str(tmp_path)})
    assert store.load() is None
    assert store.set_enabled(False) is not None  # Explicit choices repair settings.


def test_notice_is_shown_once_across_both_clis(tmp_path: Path) -> None:
    store = SettingsStore({"HYPEQUERY_CONFIG_DIR": str(tmp_path)})
    shown: list[int] = []
    store.load()
    store.mark_notice_shown(lambda: shown.append(1))
    store.mark_notice_shown(lambda: shown.append(1))
    assert shown == [1]
    assert json.loads((tmp_path / "telemetry.json").read_text())["notice_shown_at"].endswith("Z")


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX liveness check")
def test_lock_interoperates_with_typescript_owners(tmp_path: Path) -> None:
    import hashlib
    import socket
    import uuid

    host = hashlib.sha256(socket.gethostname().encode()).hexdigest()[:12]
    lock = tmp_path / "telemetry.lock"
    lock.mkdir()
    (lock / f"owner.{os.getpid()}.{host}.{uuid.uuid4()}").touch()
    assert acquire_settings_lock(tmp_path, attempts=2) is None  # A live owner keeps it.
    for child in lock.iterdir():
        child.unlink()
    exited = subprocess.Popen([sys.executable, "-c", ""])
    exited.wait()
    (lock / f"owner.{exited.pid}.{host}.{uuid.uuid4()}").touch()
    taken = acquire_settings_lock(tmp_path, attempts=1)
    assert taken is not None
    taken.release()
    assert not lock.exists()


@pytest.mark.parametrize(
    ("remote", "expected"),
    [
        (
            "git@github.com:Acme/Repo.git",
            "7de41f3d314b383d4118f638884c4e415e88baa7d0fc5455216ea1e2fe8928f7",
        ),
        (
            "https://user:tok@github.com/Acme/Repo.git?x=1",
            "7de41f3d314b383d4118f638884c4e415e88baa7d0fc5455216ea1e2fe8928f7",
        ),
        (
            "ssh://git@gitlab.example.com:2222/team/app.git",
            "566ef34facbb6a492c9a464dd87b59dea1c38c9973b27b507b3cf96f56b47523",
        ),
    ],
)
def test_project_id_matches_the_typescript_cli(tmp_path: Path, remote: str, expected: str) -> None:
    # Expected digests are the TypeScript CLI's projectId() for the same remote.
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text(f'[remote "origin"]\n\turl = {remote}\n')
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert project_id(nested, budget_seconds=1) == expected


def test_project_id_falls_back_to_pyproject_and_rejects_local_paths(tmp_path: Path) -> None:
    assert normalize_remote("C:/repos/app") is None
    assert normalize_remote("/srv/git/app.git") is None
    assert project_id(tmp_path, budget_seconds=1) is None
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "acme"\n')
    assert project_id(tmp_path, budget_seconds=1) is not None


def test_events_validate_and_reject_unknown_fields(tmp_path: Path) -> None:
    telemetry = CommandTelemetry(
        ["init", "--path", "PRIVATE"], environ=_clean_env(tmp_path), cwd=tmp_path
    )
    telemetry.begin()
    common = telemetry._common
    assert common is not None
    event = {
        **common,
        "command": "init",
        "flags_used": ["--path"],
        "outcome": "success",
        "duration_bucket": "<100ms",
    }
    assert validate_event(COMPLETED_EVENT, event)
    assert not validate_event(COMPLETED_EVENT, {**event, "path": "PRIVATE"})
    assert not validate_event(COMPLETED_EVENT, {**event, "flags_used": ["--port"]})
    assert not validate_event(COMPLETED_EVENT, {**event, "command": "PRIVATE"})
    assert not validate_event("cli_command_completed", event)


def test_debug_mode_prints_one_valid_event_without_raw_input(tmp_path: Path) -> None:
    env = _clean_env(tmp_path / "config", HYPEQUERY_TELEMETRY_DEBUG="1")
    result = _run(
        ["init", "--skip-connection", "--no-interactive", "--path", "PRIVATE-dir"], env, tmp_path
    )
    assert result.returncode == 0, result.stderr
    [event] = _events(result.stderr)
    properties = event["properties"]
    assert event["event"] == COMPLETED_EVENT
    assert event["distinct_id"] == properties["install_id"]
    assert properties["command"] == "init"
    assert properties["framework"] == "standalone"
    assert properties["interactive"] is False
    assert properties["outcome"] == "success"
    assert properties["flags_used"] == ["--no-interactive", "--path", "--skip-connection"]
    assert "PRIVATE" not in json.dumps(event)
    without_wire_fields = {k: v for k, v in properties.items() if not k.startswith("$")}
    assert validate_event(COMPLETED_EVENT, without_wire_fields)


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (["PRIVATE-command"], {"command": "unknown", "error_code": "unknown_command"}),
        (["genrate"], {"command": "unknown", "suggested_command": "generate:datasets"}),
        (["init", "--bogus"], {"command": "init", "error_code": "unknown_option"}),
        (["help", "dev"], {"command": "help", "help_topic": "dev", "outcome": "success"}),
        (["--version"], {"command": "version", "outcome": "success"}),
        (["--version", "init"], {"command": "version", "outcome": "success"}),
        (["dev", "--port", "-1"], {"command": "dev", "error_code": "usage_error"}),
        (["help", "telemetry"], {"command": "help", "help_topic": "telemetry"}),
    ],
)
def test_rejected_and_informational_invocations_are_attributed(
    tmp_path: Path, args: list[str], expected: dict[str, str]
) -> None:
    env = _clean_env(tmp_path / "config", HYPEQUERY_TELEMETRY_DEBUG="1")
    [event] = _events(_run(args, env, tmp_path).stderr)
    assert expected.items() <= event["properties"].items()
    assert "PRIVATE" not in json.dumps(event)


def test_telemetry_commands_and_opt_outs_emit_nothing(tmp_path: Path) -> None:
    env = _clean_env(tmp_path / "config", HYPEQUERY_TELEMETRY_DEBUG="1")
    disabled = _run(["telemetry", "disable"], env, tmp_path)
    assert disabled.returncode == 0, disabled.stderr
    assert "Telemetry: disabled (source: config)" in disabled.stdout
    assert _events(disabled.stderr) == []
    assert _events(_run(["--version"], env, tmp_path).stderr) == []
    _run(["telemetry", "enable"], env, tmp_path)
    assert _events(_run(["--version", "--no-telemetry"], env, tmp_path).stderr) == []
    flagged = _run(["telemetry", "status", "--no-telemetry"], env, tmp_path)
    assert "source: flag" in flagged.stdout
    dotenv = tmp_path / "project"
    dotenv.mkdir()
    (dotenv / ".env").write_text("DO_NOT_TRACK=1\n")
    assert _events(_run(["--version"], env, dotenv).stderr) == []


class _Ingest(BaseHTTPRequestHandler):
    bodies: list[bytes] = []  # noqa: RUF012 - shared with the test through the class
    status = 202

    def do_POST(self) -> None:
        self.bodies.append(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(self.status)
        self.end_headers()

    def log_message(self, *args: object) -> None:
        return


@pytest.fixture
def ingest() -> Iterator[tuple[str, type[_Ingest]]]:
    handler = type("Ingest", (_Ingest,), {"bodies": [], "status": 410})
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/api/telemetry", handler
    finally:
        server.shutdown()


def test_detached_delivery_and_kill_switch(
    tmp_path: Path, ingest: tuple[str, type[_Ingest]]
) -> None:
    url, handler = ingest
    config = tmp_path / "config"
    # Relative, as users may set it: the sender must still update this directory.
    env = _clean_env(Path("config"), HYPEQUERY_TELEMETRY_URL=url)
    result = _run(["--version"], env, tmp_path)
    assert result.returncode == 0
    assert result.stderr == ""
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        settings = json.loads((config / "telemetry.json").read_text())
        if settings.get(PYTHON_KILL_SWITCH):
            break
        time.sleep(0.05)
    [body] = handler.bodies
    batch = json.loads(body)
    assert batch["api_key"] == "hypequery-cli"
    assert [event["event"] for event in batch["batch"]] == [COMPLETED_EVENT]
    version = result.stdout.split()[-1]
    assert settings[PYTHON_KILL_SWITCH] == [version]
    assert "disabled_cli_versions" not in settings  # The TypeScript CLI's list is untouched.
    _run(["--version"], env, tmp_path)
    time.sleep(0.5)
    assert len(handler.bodies) == 1  # This version no longer sends.


def test_sender_ignores_a_local_hypequery_package(
    tmp_path: Path, ingest: tuple[str, type[_Ingest]]
) -> None:
    url, handler = ingest
    checkout = tmp_path / "checkout"
    (checkout / "hypequery").mkdir(parents=True)
    marker = tmp_path / "ran"
    (checkout / "hypequery" / "__init__.py").write_text(f"open({str(marker)!r}, 'w').close()\n")
    env = _clean_env(tmp_path / "config", HYPEQUERY_TELEMETRY_URL=url)
    executable = Path(sys.executable).with_name("hypequery")
    result = subprocess.run(
        [str(executable), "--version"],
        capture_output=True,
        text=True,
        env=env,
        cwd=checkout,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    deadline = time.monotonic() + 15
    while not handler.bodies and time.monotonic() < deadline:
        time.sleep(0.05)
    assert handler.bodies  # The installed sender delivered the batch...
    assert not marker.exists()  # ...without importing the checkout's package.


def test_unreachable_endpoint_never_delays_or_changes_the_command(tmp_path: Path) -> None:
    env = _clean_env(tmp_path / "config", HYPEQUERY_TELEMETRY_URL="https://10.255.255.1/x")
    off = _run(["--version"], {**env, "DO_NOT_TRACK": "1"}, tmp_path)
    started = time.monotonic()
    on = _run(["--version"], env, tmp_path)
    assert (on.returncode, on.stdout, on.stderr) == (off.returncode, off.stdout, off.stderr)
    assert time.monotonic() - started < 5
