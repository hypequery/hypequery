"""hypequery.agent's refusals and edge cases, without a server: bad input, refused
tokens, paging, and an adapter whose framework is not installed."""

from __future__ import annotations

import sys
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

import anyio
import pytest

from hypequery.agent import (
    HypequeryToolsError,
    InProcessToolsClient,
    RemoteToolsClient,
    ToolErrorDetails,
    ToolFailure,
    ToolResult,
    ToolSuccess,
)
from hypequery.agent.anthropic import AnthropicTools
from hypequery.agent.clients.remote import _Refusal, to_tools_error
from hypequery.agent.source import resolve_tools_client
from hypequery.agent.utils.endpoint_url import tools_endpoint_url
from hypequery.agent.utils.results import (
    data_from_result,
    error_from_result,
    read_error_envelope,
    to_definition,
)

SCHEMA = {"type": "object", "properties": {}}
URL = "https://tenant.hypequery.app/mcp"


def _details(**overrides: Any) -> ToolErrorDetails:
    fields: dict[str, Any] = {
        "code": "MCP_X",
        "category": "internal",
        "message": "x",
        "retryable": False,
        "correctable": False,
    }
    return ToolErrorDetails(**{**fields, **overrides})


class FakeExecutor:
    def __init__(self, listed: object = None, *, list_error: Exception | None = None) -> None:
        self.listed = (
            listed if listed is not None else {"tools": [{"name": "a", "inputSchema": SCHEMA}]}
        )
        self.list_error = list_error
        self.list_calls = 0

    async def list_tools(self) -> object:
        self.list_calls += 1
        if self.list_error is not None:
            raise self.list_error
        return self.listed

    async def call_tool(self, name: str, arguments: Mapping[str, object]) -> object:
        raise RuntimeError("boom")


# --- the executor client ---------------------------------------------------------


def test_an_executor_without_list_tools_and_call_tool_is_refused() -> None:
    with pytest.raises(TypeError, match="list_tools and call_tool"):
        InProcessToolsClient(object())  # type: ignore[arg-type]


def test_the_executor_lists_once_and_rethrows_its_own_errors() -> None:
    async def run() -> None:
        executor = FakeExecutor()
        client = InProcessToolsClient(executor)  # type: ignore[arg-type]
        assert [tool.name for tool in await client.list_tools()] == ["a"]
        assert [tool.name for tool in await client.list_tools()] == ["a"]
        assert executor.list_calls == 1
        await client.aclose()

        refused = HypequeryToolsError(_details(code="MCP_UNAUTHORIZED"))
        with pytest.raises(HypequeryToolsError) as raised:
            await InProcessToolsClient(FakeExecutor(list_error=refused)).list_tools()  # type: ignore[arg-type]
        assert raised.value is refused

    anyio.run(run)


def test_tools_must_be_a_list_of_names_and_input_an_object() -> None:
    with pytest.raises(TypeError, match="list of tool names"):
        InProcessToolsClient(FakeExecutor(), tools="list_datasets")  # type: ignore[arg-type]

    async def run() -> None:
        with pytest.raises(TypeError, match="must be an object"):
            await InProcessToolsClient(FakeExecutor()).call_tool("a", [1])  # type: ignore[arg-type]

    anyio.run(run)


def test_an_executor_that_lists_no_tools_is_an_error() -> None:
    async def run() -> None:
        with pytest.raises(HypequeryToolsError, match="listed no tools"):
            await InProcessToolsClient(FakeExecutor({"tools": "nope"})).list_tools()  # type: ignore[arg-type]

    anyio.run(run)


# --- choosing a client -----------------------------------------------------------


def test_token_and_tools_belong_to_their_own_source() -> None:
    with pytest.raises(TypeError, match="an executor needs neither"):
        resolve_tools_client(executor=FakeExecutor(), token="t")  # type: ignore[arg-type]  # noqa: S106 - a test credential
    with pytest.raises(TypeError, match="the endpoint decides its own tools"):
        resolve_tools_client(url=URL, token="t", tools=["a"])  # noqa: S106 - a test credential


def test_a_url_must_be_a_string() -> None:
    with pytest.raises(TypeError, match="url must be a string"):
        tools_endpoint_url(42)  # type: ignore[arg-type]


# --- errors and results ----------------------------------------------------------


def test_the_error_exposes_its_envelope() -> None:
    error = HypequeryToolsError(_details(retryable=True, hint="h", request_id="req_1"))
    assert (error.code, error.retryable, error.hint, error.request_id) == (
        "MCP_X",
        True,
        "h",
        "req_1",
    )
    assert error.to_envelope()["requestId"] == "req_1"


def test_an_envelope_needs_a_code_and_a_message() -> None:
    assert read_error_envelope("nope") is None
    assert read_error_envelope({"code": "MCP_X"}) is None


def test_an_error_result_is_read_from_its_text_when_not_structured() -> None:
    result = {
        "isError": True,
        "structuredContent": {"other": 1},
        "content": [{"type": "text", "text": '{"error": {"code": "MCP_Y", "message": "y"}}'}],
    }
    assert error_from_result(result).code == "MCP_Y"
    other = error_from_result({"isError": True, "content": [{"type": "text", "text": '{"a": 1}'}]})
    assert other.code == "MCP_EXECUTION_FAILED"
    plain = error_from_result({"isError": True, "content": [{"type": "text", "text": "[1]"}]})
    assert (plain.code, plain.message) == ("MCP_EXECUTION_FAILED", "[1]")
    assert error_from_result({"isError": True, "content": "nope"}).message == "Tool call failed"


def test_a_result_without_text_returns_its_content() -> None:
    image = [{"type": "image", "data": "..."}]
    assert data_from_result({"content": image}) == image


def test_a_listed_tool_needs_a_name_and_a_schema() -> None:
    with pytest.raises(HypequeryToolsError, match="without a name or input schema"):
        to_definition({"name": "a"})


# --- the remote client, with the transport faked ---------------------------------


class FakeHttp:
    async def __aenter__(self) -> FakeHttp:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


class FakeSession:
    def __init__(self, pages: list[Any], *, fail: Exception | None = None) -> None:
        self.pages = pages
        self.fail = fail
        self.cursors: list[str | None] = []

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def list_tools(self, cursor: str | None = None) -> Any:
        self.cursors.append(cursor)
        return self.pages[len(self.cursors) - 1]

    async def call_tool(self, name: str, arguments: Mapping[str, object]) -> Any:
        if self.fail is not None:
            raise self.fail
        return SimpleNamespace(model_dump=lambda **_: {"structuredContent": {"ok": True}})


def _tool(name: str) -> Any:
    return SimpleNamespace(model_dump=lambda **_: {"name": name, "inputSchema": SCHEMA})


def _remote(session: FakeSession, **options: Any) -> RemoteToolsClient:
    client = RemoteToolsClient(URL, "t", **options)
    refusal = _Refusal()

    async def fake_session() -> tuple[Any, Any, _Refusal]:
        return FakeHttp(), session, refusal

    client._session = fake_session  # type: ignore[method-assign]
    return client


def test_the_remote_client_follows_pages_and_lists_once() -> None:
    async def run() -> None:
        session = FakeSession(
            [
                SimpleNamespace(tools=[_tool("a")], next_cursor="2"),
                SimpleNamespace(tools=[_tool("b")], next_cursor=None),
            ]
        )
        client = _remote(session)
        assert [tool.name for tool in await client.list_tools()] == ["a", "b"]
        assert [tool.name for tool in await client.list_tools()] == ["a", "b"]
        assert session.cursors == [None, "2"]
        await client.aclose()

    anyio.run(run)


def test_the_remote_client_reports_results_and_failures() -> None:
    async def run() -> None:
        seen: list[ToolResult] = []
        result = await _remote(FakeSession([]), on_result=seen.append).call_tool("a")
        assert isinstance(result, ToolSuccess)
        assert seen == [result]

        with pytest.raises(HypequeryToolsError) as raised:
            await _remote(FakeSession([], fail=RuntimeError("down"))).call_tool("a")
        assert (raised.value.code, raised.value.retryable) == ("MCP_EXECUTION_FAILED", True)

    anyio.run(run)


def test_a_token_must_be_a_string_or_a_function() -> None:
    with pytest.raises(TypeError, match="token must be a string"):
        RemoteToolsClient(URL, 42)  # type: ignore[arg-type]


def _refusal(status: int, body: object = None) -> _Refusal:
    refusal = _Refusal()
    refusal.status, refusal.body = status, body
    return refusal


def test_a_refusal_keeps_the_endpoints_envelope_or_its_status() -> None:
    own = HypequeryToolsError(_details())
    assert to_tools_error(ExceptionGroup("g", [own])) is own

    envelope = {"error": {"code": "MCP_FORBIDDEN_TENANT", "message": "no", "hint": "h"}}
    kept = to_tools_error(RuntimeError(), _refusal(403, envelope))
    assert (kept.code, kept.hint, kept.status) == ("MCP_FORBIDDEN_TENANT", "h", 403)

    limited = to_tools_error(RuntimeError(), _refusal(429, {"other": 1}))
    assert (limited.code, limited.retryable) == ("MCP_RATE_LIMITED", True)

    failed = to_tools_error(RuntimeError(), _refusal(502))
    assert (failed.code, failed.details.message) == ("MCP_EXECUTION_FAILED", "RuntimeError")


# --- the adapters ----------------------------------------------------------------


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.closed = False

    async def list_tools(self) -> list[Any]:
        return [to_definition({"name": "a", "inputSchema": SCHEMA})]

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> ToolResult:
        self.calls.append((name, arguments))
        return ToolFailure(tool=name, error=_details())

    async def aclose(self) -> None:
        self.closed = True


def test_anthropic_refuses_a_block_without_an_id_and_closes_its_client() -> None:
    async def run() -> None:
        from hypequery.agent.anthropic import hypequery_tools

        client = FakeClient()
        tools = await hypequery_tools(client=client)
        assert isinstance(tools, AnthropicTools)
        with pytest.raises(TypeError, match="needs an id and a name"):
            await tools.tool_result({"type": "tool_use", "name": "a", "input": {}})
        await tools.aclose()
        assert client.closed

    anyio.run(run)


def test_the_openai_agents_tool_treats_non_object_arguments_as_none() -> None:
    pytest.importorskip("agents", reason="openai-agents is not installed")

    async def run() -> None:
        from hypequery.agent.openai_agents import hypequery_tools

        client = FakeClient()
        [tool] = await hypequery_tools(client=client)
        output = await tool.on_invoke_tool(None, "[1, 2]")  # type: ignore[arg-type]
        assert '"error"' in output
        assert client.calls == [("a", {})]

    anyio.run(run)


def test_the_langchain_tool_returns_json_for_errors_and_rows() -> None:
    pytest.importorskip("langchain_core", reason="langchain-core is not installed")
    import datetime
    import json

    from hypequery.agent.langchain import hypequery_tools

    class Dated(FakeClient):
        async def call_tool(
            self, name: str, arguments: Mapping[str, object] | None = None
        ) -> ToolResult:
            return ToolSuccess(tool=name, data={"data": [{"day": datetime.date(2026, 1, 2)}]})

    async def run() -> None:
        client = FakeClient()
        [tool] = await hypequery_tools(client=client)
        assert tool.description == ""
        output = await tool.ainvoke({"dataset": "orders"})
        assert json.loads(output)["error"]["code"] == _details().code
        assert client.calls == [("a", {"dataset": "orders"})]
        # LangChain alone would hand the model a Python repr of a row it cannot dump.
        [dated] = await hypequery_tools(client=Dated())
        assert json.loads(await dated.ainvoke({})) == {"data": [{"day": "2026-01-02"}]}

    anyio.run(run)


@pytest.mark.parametrize(
    ("module", "framework", "package"),
    [
        ("hypequery.agent.langchain", "langchain_core", "langchain-core"),
        ("hypequery.agent.openai_agents", "agents", "openai-agents"),
        ("hypequery.agent.pydantic_ai", "pydantic_ai", "pydantic-ai-slim"),
    ],
)
def test_an_adapter_names_the_package_it_needs(
    monkeypatch: pytest.MonkeyPatch, module: str, framework: str, package: str
) -> None:
    import importlib

    adapter = importlib.import_module(module)
    monkeypatch.setitem(sys.modules, framework, None)

    async def run() -> None:
        with pytest.raises(ImportError, match=package):
            await adapter.hypequery_tools(client=FakeClient())

    anyio.run(run)
