"""CLI development serving, including real reload workers and process shutdown."""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from hypequery.cli import main


@pytest.mark.parametrize("reload", [True, False])
def test_options_reach_runner(monkeypatch: pytest.MonkeyPatch, reload: bool) -> None:
    calls: list[tuple[object, dict[str, object]]] = []
    monkeypatch.setattr(
        "hypequery.serve.run_dev", lambda app, **options: calls.append((app, options))
    )
    args = ["dev", "example:app", "--host", "::1", "--port", "9001"]
    if not reload:
        args.append("--no-reload")
    assert main(args) == 0
    assert calls == [("example:app", {"host": "::1", "port": 9001, "reload": reload})]


def test_missing_extra_has_install_hint(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("hypequery.cli.commands.dev.find_spec", lambda name: None)
    assert main(["dev"]) == 1
    assert 'pip install "hypequery[fastapi]"' in capsys.readouterr().err


@pytest.mark.parametrize("reload", [True, False])
def test_production_app_and_bad_import_exit_promptly(tmp_path: Path, reload: bool) -> None:
    (tmp_path / "production.py").write_text(
        "from hypequery.serve import *\n"
        "app = create_app(create_router(authenticate=lambda c: None), "
        "security=HttpSecurity(allowed_hosts=('127.0.0.1',)), production=ProductionProfile())\n"
    )
    for target, message in (("production:app", "run_production"), ("missing:app", "Cannot import")):
        args = [sys.executable, "-m", "hypequery", "dev", target]
        if not reload:
            args.append("--no-reload")
        result = subprocess.run(
            args, cwd=tmp_path, capture_output=True, text=True, timeout=10, check=False
        )
        assert result.returncode == 1, result.stderr
        assert message in result.stderr
        assert "Traceback" not in result.stderr


def test_app_error_does_not_echo_credentials(tmp_path: Path) -> None:
    (tmp_path / "broken.py").write_text("raise ValueError('private-password-do-not-print')\n")
    result = subprocess.run(
        [sys.executable, "-m", "hypequery", "dev", "broken:app"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 1
    assert "private-password" not in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("reload", [True, False])
def test_real_server_reload_and_interrupt(tmp_path: Path, reload: bool) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    app = tmp_path / "app.py"
    source = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "@app.get('/revision')\n"
        "def revision():\n"
        "    return {'revision': 'first'}\n"
    )
    app.write_text(source)
    args = [sys.executable, "-m", "hypequery", "dev", "--port", str(port)]
    if not reload:
        args.append("--no-reload")
    with (tmp_path / "server.log").open("w+") as log:
        process = subprocess.Popen(
            args, cwd=tmp_path, stdout=log, stderr=log, start_new_session=True
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=1) as client:
                deadline = time.monotonic() + 20
                expected = "first"
                while True:
                    try:
                        response = client.get("/revision")
                        if response.status_code == 200 and response.json()["revision"] == expected:
                            if expected == "first" and reload:
                                # Change size as well as mtime, avoiding stale pyc reuse.
                                time.sleep(1.1)
                                app.write_text(source.replace("first", "second-revision"))
                                expected = "second-revision"
                                deadline = time.monotonic() + 20
                                continue
                            break
                    except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError):
                        pass
                    if process.poll() is not None or time.monotonic() >= deadline:
                        log.seek(0)
                        pytest.fail(f"dev server did not serve {expected}: {log.read()}")
                    time.sleep(0.1)
            process.send_signal(signal.SIGINT)
            process.wait(timeout=10)
            # Check the listener is gone after the parent exits, including its reload child.
            with socket.socket() as probe:
                assert probe.connect_ex(("127.0.0.1", port)) != 0
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


def test_occupied_port_fails(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text("from fastapi import FastAPI\napp = FastAPI()\n")
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        result = subprocess.run(
            [sys.executable, "-m", "hypequery", "dev", "--port", str(occupied.getsockname()[1])],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    assert result.returncode != 0
    assert "address already in use" in result.stderr.lower()
    assert "Traceback" not in result.stderr
