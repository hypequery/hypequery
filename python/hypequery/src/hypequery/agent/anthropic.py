"""hypequery's tools for the Anthropic Messages API.

```python
from hypequery.agent.anthropic import hypequery_tools

hq = await hypequery_tools(executor=executor)  # or url=..., token=... for hypequery Cloud
while True:
    message = await anthropic.messages.create(
        model=model, max_tokens=1024, tools=hq.tools, messages=messages
    )
    messages.append({"role": "assistant", "content": message.content})
    if message.stop_reason != "tool_use":
        break
    messages.append({"role": "user", "content": await hq.tool_results(message.content)})
```

The shapes are plain dicts, so this module imports nothing from `anthropic`:
`tools` matches its `ToolParam`, and each result its `ToolResultBlockParam`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Unpack

from .source import ToolsSource, tools_client
from .types import JsonObject, ToolResult, ToolsClient, ToolSuccess
from .utils.results import to_model_output


def _field(block: object, name: str) -> object:
    # SDK content blocks are objects; blocks you built yourself are dicts.
    return block.get(name) if isinstance(block, Mapping) else getattr(block, name, None)


def to_anthropic_tool_result(tool_use_id: str, result: ToolResult) -> JsonObject:
    """The `tool_result` block for a result: the data, or `{"error": ...}` with `is_error`."""

    block: JsonObject = {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": json.dumps(to_model_output(result), separators=(",", ":"), default=str),
    }
    if not isinstance(result, ToolSuccess):
        block["is_error"] = True
    return block


@dataclass(frozen=True)
class AnthropicTools:
    """hypequery's tools as Anthropic tool definitions, with helpers to run them."""

    #: Pass as `tools=` (alongside your own, if any).
    tools: list[JsonObject]
    client: ToolsClient

    async def run_tool(
        self, name: str, tool_input: Mapping[str, object] | None = None
    ) -> ToolResult:
        """Call one tool by name."""

        return await self.client.call_tool(name, tool_input)

    async def tool_result(self, block: object) -> JsonObject:
        """Run one `tool_use` block and build its `tool_result`."""

        tool_use_id, name, tool_input = (
            _field(block, "id"),
            _field(block, "name"),
            _field(block, "input"),
        )
        if not isinstance(tool_use_id, str) or not isinstance(name, str):
            raise TypeError("hypequery tools: a tool_use block needs an id and a name.")
        arguments = tool_input if isinstance(tool_input, Mapping) or tool_input is None else {}
        return to_anthropic_tool_result(tool_use_id, await self.run_tool(name, arguments))

    async def tool_results(self, content: Sequence[object]) -> list[JsonObject]:
        """Run every hypequery `tool_use` block in a response, concurrently, in order.

        Blocks for other tools are left for you to answer.
        """

        names = {tool["name"] for tool in self.tools}
        blocks = [
            block
            for block in content
            if _field(block, "type") == "tool_use" and _field(block, "name") in names
        ]
        return list(await asyncio.gather(*(self.tool_result(block) for block in blocks)))

    async def aclose(self) -> None:
        await self.client.aclose()


async def hypequery_tools(**source: Unpack[ToolsSource]) -> AnthropicTools:
    """List the tools once and return them as Anthropic tool definitions.

    A tool error comes back as a `tool_result` with `is_error: true` and
    hypequery's envelope as its content, so the model can correct itself. A
    refused token or an unreachable endpoint raises `HypequeryToolsError`.
    """

    client = tools_client(**source)
    definitions = await client.list_tools()
    tools: list[JsonObject] = [
        {"name": tool.name, "description": tool.description, "input_schema": tool.input_schema}
        for tool in definitions
    ]
    return AnthropicTools(tools=tools, client=client)
