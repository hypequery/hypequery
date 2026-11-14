"""hypequery.agent's remote client against a real Streamable HTTP MCP endpoint."""

from __future__ import annotations

import contextlib
import socket
from collections.abc import AsyncIterator

import anyio
import pytest

from mcp_support import Executor, build_api

pytest.importorskip("mcp", reason="the mcp extra is not installed")

import uvicorn

from hypequery.agent import HypequeryToolsError, RemoteToolsClient, ToolFailure, ToolSuccess
from hypequery.agent.anthropic import hypequery_tools as anthropic_tools
from hypequery.mcp import ApiAuthenticator, ApiExecutorFactory, create_mcp_asgi_app
from hypequery.mcp.server import McpAsgiApp


@contextlib.asynccontextmanager
async def listening(app: McpAsgiApp) -> AsyncIterator[str]:
    """Serve *app* on a free loopback port with a real ASGI server."""

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(server.serve)
        while not server.started:
            await anyio.sleep(0.01)
        try:
            yield f"http://127.0.0.1:{port}/mcp"
        finally:
            server.should_exit = True


def endpoint() -> tuple[McpAsgiApp, Executor]:
    api, rows = build_api()
    app = create_mcp_asgi_app(
        ApiExecutorFactory(api), ApiAuthenticator(api), allowed_hosts=("127.0.0.1",)
    )
    return app, rows


def test_the_remote_client_calls_the_endpoint_as_the_token_holder() -> None:
    app, rows = endpoint()
    tokens: list[str] = []

    async def token() -> str:
        # Asked for before every operation, so a short-lived token can be re-minted.
        tokens.append("reader")
        return "reader"

    async def run() -> None:
        async with listening(app) as url:
            client = RemoteToolsClient(url, token)
            names = [tool.name for tool in await client.list_tools()]
            assert names == ["list_datasets", "get_dataset_schema", "query_metric", "query_dataset"]

            result = await client.call_tool(
                "query_dataset",
                {"dataset": "orders", "dimensions": ["country"], "measures": ["total"]},
            )
            assert isinstance(result, ToolSuccess)
            failure = await client.call_tool("get_dataset_schema", {"dataset": "nope"})
            assert isinstance(failure, ToolFailure)

            hq = await anthropic_tools(url=url, token="reader")  # noqa: S106 - a test credential
            assert [tool["name"] for tool in hq.tools] == names

        assert len(tokens) == 3
        assert rows.seen
        assert all("tenant_id" in q.sql for q in rows.seen)

    anyio.run(run)


def test_a_refused_token_raises_instead_of_reaching_the_model() -> None:
    app, _ = endpoint()

    async def run() -> None:
        async with listening(app) as url:
            client = RemoteToolsClient(url, "nobody")
            with pytest.raises(HypequeryToolsError) as raised:
                await client.list_tools()
            assert raised.value.code == "MCP_UNAUTHORIZED"
            assert raised.value.status == 401
            assert not raised.value.retryable

    anyio.run(run)


def test_an_empty_token_is_refused_before_any_request() -> None:
    async def run() -> None:
        client = RemoteToolsClient("http://127.0.0.1:9/mcp", lambda: "  ")
        with pytest.raises(HypequeryToolsError, match="token is empty"):
            await client.list_tools()

    anyio.run(run)
