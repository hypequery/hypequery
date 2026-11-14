"""Tools served by an executor in this process: no endpoint, no token, no network."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from ..errors import HypequeryToolsError
from ..types import (
    OnResult,
    ToolDefinition,
    ToolErrorDetails,
    ToolExecutor,
    ToolFailure,
    ToolResult,
)
from ..utils.results import to_arguments, to_definition, to_tool_result


def _failure(message: str, *, code: str = "MCP_EXECUTION_FAILED") -> HypequeryToolsError:
    return HypequeryToolsError(
        ToolErrorDetails(
            code=code, category="internal", message=message, retryable=False, correctable=False
        )
    )


class ExecutorToolsClient:
    """The tools of an executor in this process, such as `hypequery.mcp.ClientContractExecutor`.

    The executor decides who is asking: build it per request from the signed-in
    user's credential, so every query is scoped to their tenant.
    """

    def __init__(
        self,
        executor: ToolExecutor,
        *,
        tools: Iterable[str] | None = None,
        on_result: OnResult | None = None,
    ) -> None:
        if not callable(getattr(executor, "list_tools", None)) or not callable(
            getattr(executor, "call_tool", None)
        ):
            raise TypeError(
                "hypequery tools: executor must have list_tools and call_tool, "
                "e.g. await ClientContractExecutor.create(ApiContractBackend(api, headers=...))."
            )
        if isinstance(tools, str):
            raise TypeError("hypequery tools: tools must be a list of tool names.")
        self._executor = executor
        self._allowed = None if tools is None else frozenset(tools)
        self._on_result = on_result
        self._tools: list[ToolDefinition] | None = None

    def _permits(self, name: str) -> bool:
        return self._allowed is None or name in self._allowed

    async def list_tools(self) -> list[ToolDefinition]:
        if self._tools is None:
            try:
                listed = await self._executor.list_tools()
            except HypequeryToolsError:
                raise
            except Exception as error:
                raise _failure(f"Listing tools failed: {error}") from error
            tools = listed.get("tools")
            if not isinstance(tools, list):
                raise _failure("The executor listed no tools.")
            self._tools = [
                to_definition(tool)
                for tool in tools
                if isinstance(tool, Mapping) and self._permits(str(tool.get("name")))
            ]
        return list(self._tools)

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> ToolResult:
        args = to_arguments(name, arguments)
        result: ToolResult
        if not self._permits(name):
            result = ToolFailure(
                tool=name,
                error=ToolErrorDetails(
                    code="MCP_UNKNOWN_TOOL",
                    category="correctable_input",
                    message=f"Unknown tool: {name}",
                    retryable=False,
                    correctable=True,
                ),
            )
        else:
            try:
                raw = await self._executor.call_tool(name, args)
            except Exception as error:
                # Executors return tool errors as results; anything raised is ours to fix.
                raise _failure(f"{name} failed: {error}") from error
            result = to_tool_result(name, raw)
        if self._on_result is not None:
            self._on_result(result)
        return result

    async def aclose(self) -> None:
        # Nothing to close: no session, no transport.
        return None
