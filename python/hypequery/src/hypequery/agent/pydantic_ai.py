"""hypequery's tools for Pydantic AI.

```python
from pydantic_ai import Agent
from hypequery.agent.pydantic_ai import hypequery_tools

agent = Agent("anthropic:claude-opus-5-5", tools=await hypequery_tools(executor=executor))
result = await agent.run("Which countries had the most revenue last month?")
```

Needs `pydantic-ai` (or `pydantic-ai-slim`), which is imported when the tools are built.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Unpack

from .source import ToolsSource, tools_client
from .types import ToolDefinition, ToolsClient
from .utils.results import to_model_output

if TYPE_CHECKING:
    from pydantic_ai import Tool


def _tool(client: ToolsClient, definition: ToolDefinition) -> Tool[Any]:
    from pydantic_ai import Tool

    async def run(**arguments: Any) -> object:
        return to_model_output(await client.call_tool(definition.name, arguments))

    # The server's JSON Schema is the tool's schema, so arguments are validated by
    # hypequery against the dataset, not re-modelled here.
    return Tool.from_schema(
        run,
        name=definition.name,
        description=definition.description,
        json_schema=definition.input_schema,
    )


async def hypequery_tools(**source: Unpack[ToolsSource]) -> list[Tool[Any]]:
    """List the tools once and return them as Pydantic AI tools.

    A tool error is returned to the model as `{"error": {code, message, hint, ...}}`
    so it can correct itself. A refused token or an unreachable endpoint raises
    `HypequeryToolsError`.
    """

    try:
        import pydantic_ai  # noqa: F401
    except ImportError as error:
        raise ImportError(
            'hypequery_tools for Pydantic AI needs it: pip install "pydantic-ai-slim"'
        ) from error
    client = tools_client(**source)
    return [_tool(client, definition) for definition in await client.list_tools()]
