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

from hypequery.serve import (
    AsgiApp,
    ExternalBindWarning,
    HttpSecurity,
    Principal,
    ProductionProfile,
    create_api,
    run_dev,
    to_asgi_app,
)
from hypequery.serve.dev import _RELOAD_TARGET, _reload_app
from hypequery.serve.dev.__main__ import main
from hypequery.serve.utils.bind_address import is_loopback


def _app(*, production: ProductionProfile | None = None) -> AsgiApp:
    api = create_api(
        auth=lambda credential: Principal(subject="dev"),
        security=HttpSecurity(allowed_hosts=("127.0.0.1",)),
        production=production,
    )
    return to_asgi_app(api)


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


def test_serves_an_api_through_its_asgi_app(
    served: list[tuple[object, dict[str, object]]],
) -> None:
    api = _app().api
    run_dev(api)
    target, _ = served[0]
    assert isinstance(target, AsgiApp)
    assert target.api is api


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
    with pytest.raises(ValueError, match="start_server"):
        run_dev(_app(production=ProductionProfile()).api)
    with pytest.raises(TypeError, match="to_asgi_app"):
        run_dev(object())  # type: ignore[arg-type]
    assert served == []


def _write_module(tmp_path: Path, name: str, production: bool) -> None:
    profile = "production=ProductionProfile()" if production else "production=None"
    (tmp_path / f"{name}.py").write_text(
        "from hypequery.serve import HttpSecurity, Principal, ProductionProfile, create_api,"
        " to_asgi_app\n"
        "api = create_api(auth=lambda credential: Principal(subject='dev'),"
        f" security=HttpSecurity(allowed_hosts=('127.0.0.1',)), {profile})\n"
        "app = to_asgi_app(api)\n"
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
    assert isinstance(served[0][0], AsgiApp)
    run_dev("devapp_plain:api")
    assert isinstance(served[1][0], AsgiApp)
    served.pop()
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
    assert isinstance(_reload_app(), AsgiApp)
    monkeypatch.setenv(_RELOAD_TARGET, json.dumps([str(tmp_path), "devapp_reload_production:app"]))
    with pytest.raises(ValueError, match="start_server"):
        _reload_app()


def test_reload_workers_keep_the_callers_driver_log_levels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, served: list[tuple[object, dict[str, object]]]
) -> None:
    import logging

    _write_module(tmp_path, "devapp_reload_logs", production=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "path", list(sys.path))
    driver = logging.getLogger("clickhouse_connect")
    monkeypatch.setattr(driver, "level", logging.ERROR)
    targets: list[str] = []
    monkeypatch.setattr(
        "uvicorn.run", lambda *_args, **_kwargs: targets.append(os.environ[_RELOAD_TARGET])
    )
    run_dev("devapp_reload_logs:app", reload=True)
    # The worker is a new process; its driver logger starts at the default.
    driver.setLevel(logging.NOTSET)
    monkeypatch.setenv(_RELOAD_TARGET, targets[0])
    assert isinstance(_reload_app(), AsgiApp)
    assert driver.level == logging.ERROR


def test_reload_supervisor_releases_embedded_databases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, served: list[tuple[object, dict[str, object]]]
) -> None:
    # chDB holds an on-disk database for one process. The supervisor only
    # checks the app; the worker it starts must be able to open the database,
    # also when this process had already imported the app. Executors on other
    # databases are the caller's business and stay open.
    import importlib
    import weakref

    from hypequery.execution import chdb

    class Connection:
        def __init__(self, path: str) -> None:
            self.path = path
            self.closed = False

        def query(self, sql: str, fmt: str = "JSONCompact", *, params: object = None) -> object:
            raise AssertionError("never queried")

        def close(self) -> None:
            self.closed = True

    connections: list[Connection] = []

    def connect(path: str, database: str) -> Connection:
        connections.append(Connection(path))
        return connections[-1]

    monkeypatch.setattr(chdb, "_OPEN_EXECUTORS", weakref.WeakKeyDictionary())
    monkeypatch.setattr(chdb, "_connect", connect)
    for name in ("devapp_chdb_fresh", "devapp_chdb_imported", "devapp_chdb_served"):
        (tmp_path / f"{name}.py").write_text(
            "from hypequery.execution import create_chdb_executor\n"
            "from hypequery.serve import HttpSecurity, Principal, create_api, to_asgi_app\n"
            "executor = create_chdb_executor('analytics.chdb')\n"
            "api = create_api(auth=lambda credential: Principal(subject='dev'),"
            " security=HttpSecurity(allowed_hosts=('127.0.0.1',)))\n"
            "app = to_asgi_app(api)\n"
        )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "path", [str(tmp_path), *sys.path])
    other = chdb.create_chdb_executor("other.chdb")
    in_memory = chdb.create_async_chdb_executor(":memory:")
    direct_connection = Connection("direct")
    direct = chdb.ChdbExecutor(direct_connection)

    def closed() -> list[str]:
        return [connection.path for connection in connections if connection.closed]

    run_dev("devapp_chdb_fresh:app", reload=True)
    assert served[0][0] == "hypequery.serve.dev:_reload_app"
    assert closed() == ["analytics.chdb"]

    imported = importlib.import_module("devapp_chdb_imported")
    assert closed() == ["analytics.chdb"]
    run_dev("devapp_chdb_imported:app", reload=True)
    # Checked through a fresh import, and the earlier copy's database released too.
    assert closed() == ["analytics.chdb"] * 3
    assert sys.modules["devapp_chdb_imported"] is imported

    # Served in this process, the database stays open.
    run_dev("devapp_chdb_served:app")
    assert closed() == ["analytics.chdb"] * 3
    assert not direct_connection.closed
    for executor in (other, in_memory, direct):
        executor.close()
    assert sorted(closed()) == sorted([*["analytics.chdb"] * 3, "other.chdb", ":memory:"])
    assert direct_connection.closed


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
        "from hypequery.serve import HttpSecurity, Principal, create_api, to_asgi_app\n"
        "api = create_api(auth=lambda credential: Principal(subject='dev'),"
        " security=HttpSecurity(allowed_hosts=('127.0.0.1',)), development_docs=True)\n"
        "app = to_asgi_app(api)\n"
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
            assert http.get("/openapi.json").json()["openapi"] == "3.1.0"
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
