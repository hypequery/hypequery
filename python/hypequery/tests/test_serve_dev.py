"""The development runner: loopback by default, loud about anything else."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import warnings
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from hypequery.serve import (
    ExternalBindWarning,
    HttpSecurity,
    Principal,
    ProductionProfile,
    create_app,
    create_router,
    run_dev,
)
from hypequery.serve.dev import _RELOAD_TARGET, _reload_app
from hypequery.serve.dev.__main__ import main
from hypequery.serve.utils.bind_address import is_loopback


def _app(*, production: ProductionProfile | None = None) -> FastAPI:
    router = create_router(authenticate=lambda credential: Principal(subject="dev"))
    return create_app(
        router, security=HttpSecurity(allowed_hosts=("127.0.0.1",)), production=production
    )


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch) -> list[tuple[object, dict[str, object]]]:
    calls: list[tuple[object, dict[str, object]]] = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: calls.append((app, options)))
    return calls


def test_defaults_to_loopback_without_warning(
    served: list[tuple[object, dict[str, object]]],
) -> None:
    app = _app()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        run_dev(app)
    target, options = served[0]
    assert target is app
    assert options["host"] == "127.0.0.1"
    assert options["port"] == 8000
    assert options["reload"] is False
    assert options["proxy_headers"] is False
    assert options["server_header"] is False
    assert options["workers"] == 1


@pytest.mark.parametrize("host", ["localhost", "::1", "127.0.0.2"])
def test_other_loopback_addresses_do_not_warn(
    host: str, served: list[tuple[object, dict[str, object]]]
) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        run_dev(_app(), host=host)
    assert served[0][1]["host"] == host


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.20"])  # noqa: S104
def test_external_bind_warns_clearly(
    host: str, served: list[tuple[object, dict[str, object]]]
) -> None:
    with pytest.warns(ExternalBindWarning, match="other machines on the network"):
        run_dev(_app(), host=host)
    assert served[0][1]["host"] == host


@pytest.mark.parametrize(
    ("options", "error"),
    [
        ({"host": "example.com"}, ValueError),
        ({"host": 127}, TypeError),
        ({"port": 0}, ValueError),
        ({"port": True}, ValueError),
        ({"reload": "yes"}, TypeError),
        ({"reload": True}, ValueError),
    ],
)
def test_invalid_options_fail_before_serving(
    options: dict[str, object],
    error: type[Exception],
    served: list[tuple[object, dict[str, object]]],
) -> None:
    with pytest.raises(error):
        run_dev(_app(), **options)  # type: ignore[arg-type]
    assert served == []


def test_refuses_production_apps_and_non_apps(
    served: list[tuple[object, dict[str, object]]],
) -> None:
    with pytest.raises(ValueError, match="start_server"):
        run_dev(_app(production=ProductionProfile()))
    with pytest.raises(TypeError, match="FastAPI"):
        run_dev(object())  # type: ignore[arg-type]
    assert served == []


def _write_module(tmp_path: Path, name: str, production: bool) -> None:
    profile = "production=ProductionProfile()" if production else "production=None"
    (tmp_path / f"{name}.py").write_text(
        "from hypequery.serve import HttpSecurity, Principal, ProductionProfile, create_app,"
        " create_router\n"
        "router = create_router(authenticate=lambda credential: Principal(subject='dev'))\n"
        "app = create_app(router, security=HttpSecurity(allowed_hosts=('127.0.0.1',)),"
        f" {profile})\n"
    )


def test_import_string_resolves_from_the_working_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    served: list[tuple[object, dict[str, object]]],
) -> None:
    _write_module(tmp_path, "devapp_plain", production=False)
    _write_module(tmp_path, "devapp_production", production=True)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "path", list(sys.path))
    path_before = list(sys.path)
    run_dev("devapp_plain:app")
    assert isinstance(served[0][0], FastAPI)
    assert sys.path == path_before
    with pytest.raises(ValueError, match="start_server"):
        run_dev("devapp_production:app")
    with pytest.raises(ValueError, match="start_server"):
        run_dev("devapp_production:app", reload=True)
    assert len(served) == 1
    assert sys.path == path_before
    run_dev("devapp_plain:app", reload=True)
    assert served[1] == (
        "hypequery.serve.dev:_reload_app",
        {
            "host": "127.0.0.1",
            "port": 8000,
            "reload": True,
            "factory": True,
            "workers": 1,
            "proxy_headers": False,
            "forwarded_allow_ips": "",
            "server_header": False,
            "ws": "none",
        },
    )
    assert sys.path == path_before
    assert _RELOAD_TARGET not in os.environ


def test_reload_workers_refuse_production_apps(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A reload worker imports the app itself, so the refusal must hold there
    # too, e.g. when a file change turns a development app into a production one.
    _write_module(tmp_path, "devapp_reload_plain", production=False)
    _write_module(tmp_path, "devapp_reload_production", production=True)
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setenv(_RELOAD_TARGET, json.dumps([str(tmp_path), "devapp_reload_plain:app"]))
    assert isinstance(_reload_app(), FastAPI)
    monkeypatch.setenv(_RELOAD_TARGET, json.dumps([str(tmp_path), "devapp_reload_production:app"]))
    with pytest.raises(ValueError, match="start_server"):
        _reload_app()


def test_module_entry_point_passes_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, dict[str, object]]] = []
    monkeypatch.setattr(
        "hypequery.serve.dev.__main__.run_dev",
        lambda app, **options: calls.append((app, options)),
    )
    main(["app:app", "--host", "::1", "--port", "9000", "--reload"])
    assert calls == [("app:app", {"host": "::1", "port": 9000, "reload": True})]


def test_is_loopback() -> None:
    assert is_loopback("localhost")
    assert is_loopback("127.0.0.1")
    assert not is_loopback("10.0.0.1")
    with pytest.raises(ValueError, match="IP address"):
        is_loopback("my-laptop.local")


def test_real_dev_server_serves_docs_on_loopback(tmp_path: Path) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    (tmp_path / "devapp.py").write_text(
        "from hypequery.serve import HttpSecurity, Principal, create_app, create_router\n"
        "router = create_router(authenticate=lambda credential: Principal(subject='dev'))\n"
        "app = create_app(router, security=HttpSecurity(allowed_hosts=('127.0.0.1',)),"
        " development_docs=True)\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-m", "hypequery.serve.dev", "devapp:app", "--port", str(port)],
        cwd=tmp_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=1) as http:
            until = time.monotonic() + 10
            while True:
                try:
                    response = http.get("/docs")
                    break
                except httpx.ConnectError:
                    if process.poll() is not None or time.monotonic() >= until:
                        pytest.fail("development server failed to start")
                    time.sleep(0.05)
            assert response.status_code == 200
            assert "server" not in response.headers
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
