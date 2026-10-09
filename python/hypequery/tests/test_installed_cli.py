"""Installed onboarding must exclude Node and retain failure diagnostics."""

from __future__ import annotations

import importlib
import os
import shutil
from pathlib import Path
from types import ModuleType
from typing import TextIO, cast
from unittest.mock import Mock

import pytest


@pytest.fixture
def installed_cli(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "scripts"))
    return importlib.import_module("utils.installed_cli")


def test_child_path_excludes_node_in_system_directories(
    installed_cli: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    system = tmp_path / "system"
    system.mkdir()
    node = system / "node"
    node.write_text("#!/bin/sh\nexit 0\n")
    node.chmod(0o755)
    monkeypatch.setattr(os, "defpath", str(system))
    monkeypatch.setenv("PATH", str(system))
    assert shutil.which("node") == str(node)
    journey = installed_cli.InstalledCli(tmp_path, tmp_path / "sdk.whl", minimal=True)
    assert shutil.which("node", path=journey.env["PATH"]) is None
    assert journey.env["PATH"] == str(journey.python.parent)


@pytest.mark.parametrize("failure", ["shutdown", "listener"])
def test_shutdown_failures_retain_server_logs(
    installed_cli: ModuleType,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    failure: str,
) -> None:
    journey = installed_cli.InstalledCli(tmp_path, tmp_path / "sdk.whl", minimal=True)
    journey.project.mkdir()
    monkeypatch.setattr(journey, "_wait", Mock(side_effect=RuntimeError("startup failed")))
    stop = Mock(side_effect=RuntimeError("shutdown failed") if failure == "shutdown" else None)
    monkeypatch.setattr(journey, "_stop", stop)
    socket = Mock()
    socket.__enter__ = Mock(return_value=socket)
    socket.__exit__ = Mock(return_value=False)
    socket.getsockname.return_value = ("127.0.0.1", 8125)
    socket.connect_ex.return_value = 0
    monkeypatch.setattr("socket.socket", Mock(return_value=socket))

    def start(*args: object, **kwargs: object) -> Mock:
        cast(TextIO, kwargs["stdout"]).write("server shutdown diagnostics\n")
        return Mock()

    monkeypatch.setattr("subprocess.Popen", start)
    message = "shutdown failed" if failure == "shutdown" else "Server child survived cleanup"
    with pytest.raises(RuntimeError, match=message):
        journey._serve()
    assert "server shutdown diagnostics" in capsys.readouterr().err
    stop.assert_called_once()
