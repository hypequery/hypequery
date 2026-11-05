"""`hypequery mcp`: configuration, self-test and a real stdio session."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from hypequery.cli import main

APP = '''
"""A served API with a fake executor: no database needed."""
import re
from dataclasses import dataclass

from hypequery.datasets import (
    ClientQueryProfile, Dataset, create_dataset_client, dimension, measure,
)
from hypequery.serve import (
    Credential, HttpSecurity, Principal, add_client_contract_endpoint, add_dataset_endpoint,
    create_api, to_asgi_app,
)

print("import chatter that must not reach the MCP stdout")


@dataclass(frozen=True)
class Rows:
    columns: tuple
    rows: tuple


class Executor:
    def execute(self, compiled):
        print("query-time chatter that must not reach the MCP stdout")
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql.split(" FROM ", 1)[0]))
        values = {"country": "US", "total": 7}
        return Rows(columns, (tuple(values[name] for name in columns),))


def authenticate(credential: Credential):
    return Principal(subject="agent") if credential.value == "secret" else None


orders = Dataset(
    name="orders",
    source="orders",
    dimensions={"country": dimension.string()},
    measures={"total": measure.count("country")},
)
api = create_api(auth=authenticate, security=HttpSecurity(allowed_hosts=("localhost",)))
add_dataset_endpoint(
    api, "/orders", dataset=orders, client=create_dataset_client(executor=Executor()),
    client_profile=ClientQueryProfile(),
)
add_client_contract_endpoint(api)
app = to_asgi_app(api)
'''


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "app.py").write_text(APP)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HYPEQUERY_API_KEY", "secret")
    monkeypatch.delitem(sys.modules, "app", raising=False)
    return tmp_path


def test_print_config_names_the_project_and_never_the_key(
    project: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["mcp", "app:api", "--print-config"]) == 0
    config = json.loads(capsys.readouterr().out)
    server = config["mcpServers"]["hypequery"]
    assert server["command"] == sys.executable
    assert server["args"] == ["-m", "hypequery", "mcp", "app:api", "--project", str(project)]
    assert server["env"] == {"HYPEQUERY_API_KEY": "${HYPEQUERY_API_KEY}"}
    assert "secret" not in json.dumps(config)


def test_print_config_for_the_bridge(capsys: pytest.CaptureFixture[str]) -> None:
    url = "https://analytics.example.com/v1/client-contract"
    assert main(["mcp", "--client-contract-url", url, "--print-config"]) == 0
    server = json.loads(capsys.readouterr().out)["mcpServers"]["hypequery"]
    assert server["args"] == ["-m", "hypequery", "mcp", "--client-contract-url", url]


@pytest.mark.parametrize("target", ["app:api", "app:app"])
def test_self_test_reads_the_contract_in_process(
    project: Path, target: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["mcp", target, "--self-test"]) == 0
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "4 tools over 1 authorized endpoints (1 dataset, 0 metric)" in captured.err
    assert "import chatter" in captured.err


def test_self_test_reports_a_refused_credential(
    project: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("HYPEQUERY_API_KEY", "wrong")
    assert main(["mcp", "--self-test"]) == 1
    error = capsys.readouterr().err
    assert "Backend access denied." in error
    assert "wrong" not in error


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["mcp", "app:nothing", "--self-test"], "app has no attribute nothing"),
        (["mcp", "missing:api", "--self-test"], "Cannot import missing:api"),
        (["mcp", "app", "--self-test"], "Use module:attribute"),
        (["mcp", "--header", "broken", "--self-test"], "Use --header 'Name: value'."),
        (["mcp", "--client-contract-url", "http://example.com/c", "--self-test"], "HTTPS"),
    ],
)
def test_configuration_errors_are_actionable(
    project: Path, argv: list[str], message: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(argv) == 1
    assert message in capsys.readouterr().err


def test_an_api_without_a_client_contract_is_a_setup_error(
    project: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (project / "bare.py").write_text(
        "from hypequery.serve import create_api\napi = create_api(auth=lambda credential: None)\n"
    )
    assert main(["mcp", "bare:api", "--self-test"]) == 1
    error = capsys.readouterr().err
    assert "add_client_contract_endpoint(api)" in error
    assert "Traceback" not in error


def test_print_config_refuses_a_header_it_would_drop_or_leak(
    project: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["mcp", "--header", "X-Api-Key: k", "--print-config"]) == 1
    error = capsys.readouterr().err
    assert "HYPEQUERY_API_KEY" in error
    assert " k" not in error.split("--header")[0]


def test_an_unexpanded_key_placeholder_is_refused(
    project: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("HYPEQUERY_API_KEY", "${HYPEQUERY_API_KEY}")
    assert main(["mcp", "--self-test"]) == 1
    assert "unexpanded placeholder" in capsys.readouterr().err


def test_the_projects_env_wins_over_the_launch_directory(
    project: Path, tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    launch = tmp_path_factory.mktemp("launch")
    (launch / ".env").write_text("HYPEQUERY_API_KEY=wrong\n")
    (project / ".env").write_text("HYPEQUERY_API_KEY=secret\n")
    monkeypatch.delenv("HYPEQUERY_API_KEY")
    monkeypatch.chdir(launch)
    assert main(["mcp", "app:api", "--project", str(project), "--self-test"]) == 0


def test_the_project_stays_importable_after_loading(project: Path) -> None:
    assert main(["mcp", "app:api", "--self-test"]) == 0
    assert str(project) in sys.path


def test_an_app_and_a_url_are_exclusive() -> None:
    with pytest.raises(SystemExit) as raised:
        main(["mcp", "app:api", "--client-contract-url", "https://a.example/c"])
    assert raised.value.code == 2


def test_a_real_stdio_session(project: Path) -> None:
    mcp = pytest.importorskip("mcp")

    async def session() -> None:
        parameters = mcp.StdioServerParameters(
            command=sys.executable,
            args=["-m", "hypequery", "mcp", "app:api", "--project", str(project)],
            env={"HYPEQUERY_API_KEY": "secret", "PATH": ""},
        )
        async with mcp.Client(parameters) as client:
            tools = await client.list_tools()
            assert len(tools.tools) == 4
            result = await client.call_tool(
                "query_dataset",
                {"dataset": "orders", "dimensions": ["country"], "measures": ["total"]},
            )
            assert not result.is_error, result
            assert result.structured_content == {"data": [{"country": "US", "total": "7"}]}

    asyncio.run(session())
