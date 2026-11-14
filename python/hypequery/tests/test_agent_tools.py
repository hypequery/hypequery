"""hypequery.agent's tools: the in-process client, the adapters, and the shared result handling."""

from __future__ import annotations

import json
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

import anyio
import pytest

from hypequery.agent import (
    ExecutorToolsClient,
    HypequeryToolsError,
    ToolFailure,
    ToolResult,
    ToolSuccess,
    resolve_tools_client,
    to_model_output,
)
from hypequery.agent.anthropic import hypequery_tools as anthropic_tools
from hypequery.agent.utils.endpoint_url import tools_endpoint_url
from hypequery.agent.utils.results import error_from_result, to_tool_result
from hypequery.mcp import ApiContractBackend, ClientContractExecutor
from mcp_support import READER, build_api

TOOLS = ["list_datasets", "get_dataset_schema", "query_metric", "query_dataset"]


async def reader_executor() -> tuple[ClientContractExecutor, Any]:
    """The tools for the signed-in reader of tenant `acme`, built as an app would per request."""

    api, rows = build_api()
    executor = await ClientContractExecutor.create(ApiContractBackend(api, headers=READER))
    return executor, rows


def test_the_executor_client_lists_and_runs_the_tools_for_one_tenant() -> None:
    async def run() -> None:
        executor, rows = await reader_executor()
        seen: list[ToolResult] = []
        client = ExecutorToolsClient(executor, on_result=seen.append)

        assert [tool.name for tool in await client.list_tools()] == TOOLS
        result = await client.call_tool(
            "query_dataset", {"dataset": "orders", "dimensions": ["country"], "measures": ["total"]}
        )
        assert isinstance(result, ToolSuccess)
        assert isinstance(result.data, Mapping)
        assert result.data["data"]
        # The API's own auth decided the tenant: every query is scoped to it.
        assert rows.seen
        assert all("tenant_id" in query.sql for query in rows.seen)
        assert seen == [result]

    anyio.run(run)


def test_a_tool_error_is_a_result_the_model_can_act_on() -> None:
    async def run() -> None:
        executor, _ = await reader_executor()
        client = ExecutorToolsClient(executor)
        result = await client.call_tool("get_dataset_schema", {"dataset": "nope"})
        assert isinstance(result, ToolFailure)
        assert result.error.code.startswith("MCP_")
        output = to_model_output(result)
        assert isinstance(output, dict)
        assert output["error"]["code"] == result.error.code

    anyio.run(run)


def test_an_allowlist_hides_and_refuses_other_tools() -> None:
    async def run() -> None:
        executor, _ = await reader_executor()
        client = ExecutorToolsClient(executor, tools=["list_datasets", "query_dataset"])
        assert [tool.name for tool in await client.list_tools()] == [
            "list_datasets",
            "query_dataset",
        ]
        refused = await client.call_tool("query_metric", {"metric": "ordersTotal"})
        assert isinstance(refused, ToolFailure)
        assert refused.error.code == "MCP_UNKNOWN_TOOL"
        assert refused.error.correctable

    anyio.run(run)


def test_an_executor_that_raises_is_a_tools_error() -> None:
    class Broken:
        async def list_tools(self) -> Mapping[str, object]:
            raise RuntimeError("boom")

        async def call_tool(
            self, name: str, arguments: Mapping[str, object] | None = None
        ) -> Mapping[str, object]:
            raise RuntimeError("boom")

    async def run() -> None:
        client = ExecutorToolsClient(Broken())
        with pytest.raises(HypequeryToolsError):
            await client.list_tools()
        with pytest.raises(HypequeryToolsError):
            await client.call_tool("list_datasets")

    anyio.run(run)


def test_sources_are_one_of_executor_url_or_client() -> None:
    with pytest.raises(TypeError, match="exactly one"):
        resolve_tools_client()
    with pytest.raises(TypeError, match="exactly one"):
        resolve_tools_client(url="https://x.hypequery.app/mcp", client=object())  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="needs token"):
        resolve_tools_client(url="https://x.hypequery.app/mcp")
    with pytest.raises(TypeError, match="executor needs neither"):
        resolve_tools_client(executor=object(), token="t")  # type: ignore[arg-type]  # noqa: S106 - a test credential
    with pytest.raises(TypeError, match="list_tools and call_tool"):
        resolve_tools_client(executor=object())  # type: ignore[arg-type]


def test_tokens_travel_over_https_or_to_this_machine_only() -> None:
    assert tools_endpoint_url("https://acme.hypequery.app/mcp")
    assert tools_endpoint_url("http://localhost:3001/mcp")
    assert tools_endpoint_url("http://127.0.0.1:3001/mcp")
    with pytest.raises(ValueError, match="https"):
        tools_endpoint_url("http://acme.example.com/mcp")
    with pytest.raises(ValueError, match="tenant MCP endpoint"):
        tools_endpoint_url("ftp://acme.example.com/mcp")


def test_error_envelopes_are_read_as_typescript_reads_them() -> None:
    structured = {
        "isError": True,
        "structuredContent": {
            "error": {
                "code": "MCP_RATE_LIMITED",
                "category": "budget",
                "message": "Too many queries",
                "retryable": True,
                "correctable": False,
                "retryAfterSeconds": 30,
                "hint": "Wait 30 seconds.",
            }
        },
        "_meta": {"com.hypequery/requestId": "req_1"},
    }
    failure = to_tool_result("query_dataset", structured)
    assert isinstance(failure, ToolFailure)
    assert failure.error.retry_after_seconds == 30
    assert failure.request_id == "req_1"
    assert failure.error.to_envelope() == {
        "code": "MCP_RATE_LIMITED",
        "category": "budget",
        "message": "Too many queries",
        "retryable": True,
        "correctable": False,
        "retryAfterSeconds": 30.0,
        "hint": "Wait 30 seconds.",
        "requestId": "req_1",
    }
    formatted = error_from_result(
        {
            "isError": True,
            "content": [{"type": "text", "text": "Error [MCP_NOT_FOUND]: no such dataset"}],
        }
    )
    assert (formatted.code, formatted.message) == ("MCP_NOT_FOUND", "no such dataset")
    success = to_tool_result(
        "list_datasets", {"content": [{"type": "text", "text": '{"total": 1}'}]}
    )
    assert isinstance(success, ToolSuccess)
    assert success.data == {"total": 1}


def test_anthropic_answers_its_tool_use_blocks() -> None:
    async def run() -> None:
        executor, _ = await reader_executor()
        hq = await anthropic_tools(executor=executor)
        assert [tool["name"] for tool in hq.tools] == TOOLS
        assert all({"name", "description", "input_schema"} == set(tool) for tool in hq.tools)

        content = [
            # An SDK block (attributes) and a dict block, plus a block for someone else's tool.
            SimpleNamespace(type="tool_use", id="toolu_1", name="list_datasets", input={}),
            {
                "type": "tool_use",
                "id": "toolu_2",
                "name": "get_dataset_schema",
                "input": {"dataset": "nope"},
            },
            {"type": "tool_use", "id": "toolu_3", "name": "send_email", "input": {}},
            {"type": "text", "text": "Let me look."},
        ]
        results = await hq.tool_results(content)
        assert [block["tool_use_id"] for block in results] == ["toolu_1", "toolu_2"]
        assert "is_error" not in results[0]
        assert results[1]["is_error"] is True
        assert "error" in json.loads(str(results[1]["content"]))

    anyio.run(run)


def test_openai_agents_function_tools_return_json_to_the_model() -> None:
    pytest.importorskip("agents", reason="openai-agents is not installed")
    from hypequery.agent.openai_agents import hypequery_tools

    async def run() -> None:
        executor, rows = await reader_executor()
        tools = await hypequery_tools(executor=executor, tools=["list_datasets", "query_dataset"])
        assert [tool.name for tool in tools] == ["list_datasets", "query_dataset"]
        query = next(tool for tool in tools if tool.name == "query_dataset")
        assert query.strict_json_schema is False
        output = await query.on_invoke_tool(
            None,  # type: ignore[arg-type]
            json.dumps({"dataset": "orders", "dimensions": ["country"], "measures": ["total"]}),
        )
        assert json.loads(output)["data"]
        assert rows.seen
        assert all("tenant_id" in q.sql for q in rows.seen)

    anyio.run(run)


def test_pydantic_ai_runs_the_tools_in_an_agent_loop() -> None:
    pytest.importorskip("pydantic_ai", reason="pydantic-ai is not installed")
    from pydantic_ai import Agent
    from pydantic_ai.messages import (
        ModelMessage,
        ModelResponse,
        TextPart,
        ToolCallPart,
        ToolReturnPart,
    )
    from pydantic_ai.models.function import AgentInfo, FunctionModel

    from hypequery.agent.pydantic_ai import hypequery_tools

    returned: list[object] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        # Call query_dataset once, then answer with what it returned.
        for message in messages:
            for part in getattr(message, "parts", []):
                if isinstance(part, ToolReturnPart):
                    returned.append(part.content)
                    return ModelResponse(parts=[TextPart("done")])
        assert "query_dataset" in [tool.name for tool in info.function_tools]
        args = {"dataset": "orders", "dimensions": ["country"], "measures": ["total"]}
        return ModelResponse(parts=[ToolCallPart("query_dataset", args)])

    async def run() -> None:
        executor, rows = await reader_executor()
        agent = Agent(FunctionModel(model), tools=await hypequery_tools(executor=executor))
        result = await agent.run("Orders by country?")
        assert result.output == "done"
        assert isinstance(returned[0], dict)
        assert returned[0]["data"]
        assert rows.seen
        assert all("tenant_id" in q.sql for q in rows.seen)

    anyio.run(run)
