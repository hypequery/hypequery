"""`hypequery mcp --http`: flags, the choice of credential check, and a served request."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from hypequery.cli import main
from hypequery.cli.errors import CliError
from hypequery.cli.utils.mcp_http import mcp_http_settings
from test_cli_mcp import APP

KEY = "cli-static-key-0123456789"
INITIALIZE = json.dumps(
    {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "cli-test", "version": "1"},
        },
    }
).encode()


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "app.py").write_text(APP)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("HYPEQUERY_API_KEY", raising=False)
    monkeypatch.delenv("HYPEQUERY_MCP_KEY", raising=False)
    monkeypatch.delitem(sys.modules, "app", raising=False)
    return tmp_path


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Replace uvicorn with one that sends requests through the app, then stops."""

    uvicorn = pytest.importorskip("uvicorn")
    httpx2 = pytest.importorskip("httpx2")
    results: list[Any] = []
    tokens: list[str] = []

    class Server:
        def __init__(self, config: Any) -> None:
            self.config = config

        async def serve(self) -> None:
            app = self.config.app
            results.append(self.config)
            async with app.run():
                transport = httpx2.ASGITransport(app=app)
                async with httpx2.AsyncClient(
                    transport=transport, base_url="http://localhost"
                ) as client:
                    for token in tokens:
                        response = await client.post(
                            "/mcp",
                            headers={
                                "authorization": f"Bearer {token}",
                                "accept": "application/json, text/event-stream",
                                "content-type": "application/json",
                            },
                            content=INITIALIZE,
                        )
                        results.append(response)

    monkeypatch.setattr(uvicorn, "Server", Server)
    results.append(tokens)
    return results


def test_a_static_key_guards_the_api(
    project: Path, served: list[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("mcp")
    tokens = served.pop(0)
    tokens.extend([KEY, "wrong-key-0123456789"])
    monkeypatch.setenv("HYPEQUERY_MCP_KEY", KEY)
    monkeypatch.setenv("HYPEQUERY_API_KEY", "secret")
    assert main(["mcp", "app:api", "--http", "--port", "0"]) == 0
    config, accepted, refused = served
    assert (config.host, config.port) == ("127.0.0.1", 0)
    assert accepted.status_code == 200
    assert refused.status_code == 401


def test_the_apis_own_auth_checks_each_caller(project: Path, served: list[Any]) -> None:
    pytest.importorskip("mcp")
    tokens = served.pop(0)
    tokens.extend(["secret", "wrong"])
    assert main(["mcp", "app:api", "--http"]) == 0
    _, accepted, refused = served
    assert accepted.status_code == 200
    assert refused.status_code == 401
    assert refused.headers["www-authenticate"] == 'Bearer error="invalid_token"'


def test_the_bridge_needs_the_static_key(project: Path, capsys: pytest.CaptureFixture[str]) -> None:
    pytest.importorskip("mcp")
    url = "https://analytics.example.com/v1/client-contract"
    assert main(["mcp", "--client-contract-url", url, "--http"]) == 1
    assert "HYPEQUERY_MCP_KEY" in capsys.readouterr().err


def test_an_oauth_resource_the_api_does_not_accept_is_refused(
    project: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pytest.importorskip("mcp")
    pytest.importorskip("jwt")
    (project / "jwt_app.py").write_text(
        APP.replace(
            "create_api(auth=authenticate,",
            "create_api(auth=__import__('hypequery.serve').serve.jwt_strategy("
            "secret='s' * 32, audience='https://other.example.com/mcp'),",
        )
    )
    argv = [
        "mcp",
        "jwt_app:api",
        "--http",
        "--resource",
        "https://mcp.example.com/mcp",
        "--authorization-servers",
        "https://auth.example.com",
    ]
    assert main(argv) == 1
    assert "must accept audience" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["mcp", "--port", "1234"], "--port is only used with --http"),
        (["mcp", "--http", "--self-test"], "cannot be combined"),
        (["mcp", "--resource", "https://m.example.com/mcp"], "--resource is only used with --http"),
    ],
)
def test_http_flag_combinations_are_refused(
    argv: list[str], message: str, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as raised:
        main(argv)
    assert raised.value.code == 2
    assert message in capsys.readouterr().err


def test_settings_derive_hosts_and_refuse_unsafe_binds() -> None:
    def settings(**overrides: Any) -> Any:
        values: dict[str, Any] = {
            "port": None,
            "host": None,
            "allowed_hosts": None,
            "allowed_origins": None,
            "resource": None,
            "authorization_servers": None,
            "required_scopes": None,
            "env": {},
        }
        values.update(overrides)
        return mcp_http_settings(**values)

    assert settings().allowed_hosts == ("localhost", "127.0.0.1", "[::1]")
    oauth = settings(
        resource="https://mcp.example.com/mcp", authorization_servers="https://a.example.com"
    )
    assert oauth.allowed_hosts[0] == "mcp.example.com"
    # A routable bind address (not all interfaces, which the linter flags) needs explicit hosts.
    assert settings(host="10.0.0.5", allowed_hosts="a.test, b.test").allowed_hosts == (
        "a.test",
        "b.test",
    )
    with pytest.raises(CliError, match="allowed-hosts"):
        settings(host="10.0.0.5")
    with pytest.raises(CliError, match="authorization-servers"):
        settings(resource="https://mcp.example.com/mcp")
    with pytest.raises(CliError, match="alternatives"):
        settings(
            resource="https://mcp.example.com/mcp",
            authorization_servers="https://a.example.com",
            env={"HYPEQUERY_MCP_KEY": KEY},
        )
    with pytest.raises(CliError, match="port"):
        settings(port=70000)
