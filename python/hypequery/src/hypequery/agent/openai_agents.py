"""hypequery's tools for the OpenAI Agents SDK.

```python
from agents import Agent, Runner
from hypequery.agent.openai_agents import hypequery_tools

agent = Agent(name="Analyst", tools=await hypequery_tools(executor=executor))
result = await Runner.run(agent, "Which countries had the most revenue last month?")
```

Needs `openai-agents`, which is imported when the tools are built.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Unpack

from .source import ToolsSource, tools_client
from .types import ToolDefinition, ToolsClient
from .utils.results import to_model_output

if TYPE_CHECKING:
    from agents import FunctionTool


def _function_tool(client: ToolsClient, definition: ToolDefinition) -> FunctionTool:
    from agents import FunctionTool

    async def invoke(_context: Any, arguments: str) -> str:
        parsed: object = json.loads(arguments) if arguments.strip() else {}
        if not isinstance(parsed, dict):
            parsed = {}
        result = await client.call_tool(definition.name, parsed)
        return json.dumps(to_model_output(result), separators=(",", ":"), default=str)

    # The server's JSON Schemas are passed through unchanged, so the tools are not
    # strict: strict mode would need every property required.
    return FunctionTool(
        name=definition.name,
        description=definition.description,
        params_json_schema=definition.input_schema,
        on_invoke_tool=invoke,
        strict_json_schema=False,
    )


async def hypequery_tools(**source: Unpack[ToolsSource]) -> list[FunctionTool]:
    """List the tools once and return them as Agents SDK function tools.

    A tool error is returned to the model as `{"error": {code, message, hint, ...}}`
    so it can correct itself. A refused token or an unreachable endpoint raises
    `HypequeryToolsError`, which the Agents SDK reports as a tool failure.
    """

    try:
        import agents  # noqa: F401
    except ImportError as error:
        raise ImportError(
            "hypequery_tools for the OpenAI Agents SDK needs it: pip install openai-agents"
        ) from error
    client = tools_client(**source)
    return [_function_tool(client, definition) for definition in await client.list_tools()]
