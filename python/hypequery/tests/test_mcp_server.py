"""The SDK-backed MCP server, driven by the official MCP client in-process."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from mcp_support import READER, build_api

pytest.importorskip("mcp", reason="the mcp extra is not installed")

from mcp import Client
from mcp.shared.exceptions import MCPError

from hypequery.mcp import (
    ApiContractBackend,
    ClientContractExecutor,
    create_mcp_server,
)


async def served() -> Any:
    api, _ = build_api()
    executor = await ClientContractExecutor.create(ApiContractBackend(api, headers=READER))
    return create_mcp_server(executor)


def test_a_client_sees_the_tools_and_calls_them() -> None:
    async def session() -> None:
        async with Client(await served()) as client:
            tools = await client.list_tools()
            assert [tool.name for tool in tools.tools] == [
                "list_datasets",
                "get_dataset_schema",
                "query_metric",
                "query_dataset",
            ]
            query = next(tool for tool in tools.tools if tool.name == "query_dataset")
            assert query.annotations is not None
            assert query.annotations.read_only_hint is True
            assert tools.meta is not None
            assert "com.hypequery/manifestHash" in tools.meta

            result = await client.call_tool(
                "query_dataset", {"dataset": "orders", "measures": ["total"], "limit": 1}
            )
            assert not result.is_error
            assert result.structured_content == {"data": [{"total": "10"}]}

            refused = await client.call_tool("query_dataset", {"dataset": "orders", "sql": "1"})
            assert refused.is_error
            assert refused.structured_content is not None
            assert refused.structured_content["error"]["code"] == "MCP_INVALID_ARGUMENTS"

    asyncio.run(session())


def test_the_guide_prompt_is_served_and_unknown_prompts_are_protocol_errors() -> None:
    async def session() -> None:
        async with Client(await served()) as client:
            prompts = await client.list_prompts()
            assert [prompt.name for prompt in prompts.prompts] == ["dataset_guide"]
            guide = await client.get_prompt("dataset_guide")
            assert guide.messages[0].role == "user"
            with pytest.raises(MCPError, match="MCP_NOT_FOUND"):
                await client.get_prompt("other")

    asyncio.run(session())


def test_the_server_names_itself_and_its_version() -> None:
    import hypequery

    server = asyncio.run(served())
    assert server.name == "hypequery-mcp-server"
    assert server.version == hypequery.__version__
