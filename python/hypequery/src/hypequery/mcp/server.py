"""The MCP protocol adapter: an executor behind the official `mcp` SDK's server.

The only module that imports the SDK. Tools and prompts come from the
executor as plain JSON data and are validated into the SDK's types here, so
the executor stays transport-neutral and testable without a session.
"""

from __future__ import annotations

from typing import Any

import mcp_types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.shared.exceptions import MCPError

from .. import __version__
from .errors import classify_mcp_tool_error
from .executor import ClientContractExecutor

SERVER_NAME = "hypequery-mcp-server"


def _protocol_error(error: Exception) -> MCPError:
    """A JSON-RPC error carrying only the classified, public details of *error*.

    Anything but an `McpToolError` becomes the generic failure, so a backend's
    or driver's message never reaches the agent.
    """

    details = classify_mcp_tool_error(error)
    return MCPError(types.INTERNAL_ERROR, details["message"], data={"error": dict(details)})


def create_mcp_server(
    executor: ClientContractExecutor, *, name: str = SERVER_NAME, version: str = __version__
) -> Server[Any]:
    """An MCP server exposing *executor*'s tools and its `dataset_guide` prompt."""

    async def list_tools(
        _context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListToolsResult:
        try:
            return types.ListToolsResult.model_validate(await executor.list_tools())
        except Exception as error:
            raise _protocol_error(error) from None

    async def call_tool(_context: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        return types.CallToolResult.model_validate(
            await executor.call_tool(params.name, params.arguments)
        )

    async def list_prompts(
        _context: Any, _params: types.PaginatedRequestParams | None
    ) -> types.ListPromptsResult:
        try:
            return types.ListPromptsResult.model_validate(await executor.list_prompts())
        except Exception as error:
            raise _protocol_error(error) from None

    async def get_prompt(
        _context: Any, params: types.GetPromptRequestParams
    ) -> types.GetPromptResult:
        try:
            return types.GetPromptResult.model_validate(
                await executor.get_prompt(params.name, params.arguments)
            )
        except Exception as error:
            raise _protocol_error(error) from None

    return Server(
        name,
        version=version,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
        on_list_prompts=list_prompts,
        on_get_prompt=get_prompt,
    )


async def serve_stdio(server: Server[Any]) -> None:
    """Serve *server* over this process's stdin and stdout until the client disconnects.

    stdout carries only protocol messages while serving; log to stderr.
    """

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
