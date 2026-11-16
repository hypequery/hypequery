"""hypequery's tools for LangChain and LangGraph.

```python
from langchain.agents import create_agent
from hypequery.agent.langchain import hypequery_tools

agent = create_agent("anthropic:claude-opus-5-5", tools=await hypequery_tools(executor=executor))
result = await agent.ainvoke(
    {"messages": [{"role": "user", "content": "Which countries had the most revenue last month?"}]}
)
```

The tools are `langchain_core` tools, so they also work with `model.bind_tools(...)`
and LangGraph's `ToolNode`. They are async: run the agent with `ainvoke` or `astream`.

Needs `langchain-core` 0.3.36 or later, which `langchain` and `langgraph` install;
it is imported when the tools are built.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Unpack

from .source import ToolsSource, resolve_tools_client
from .types import ToolDefinition, ToolsClient
from .utils.model_input_schema import to_model_input_schema
from .utils.results import to_model_output

if TYPE_CHECKING:
    from langchain_core.tools import StructuredTool


def _structured_tool(client: ToolsClient, definition: ToolDefinition) -> StructuredTool:
    from langchain_core.tools import StructuredTool

    async def run(**arguments: Any) -> str:
        result = await client.call_tool(definition.name, arguments)
        # JSON, not the dict: LangChain falls back to `str()` for a value `json.dumps`
        # refuses, such as a date in a row, and the model would read a Python repr.
        return json.dumps(to_model_output(result), separators=(",", ":"), default=str)

    # The server's JSON Schema is the tool's schema, so arguments are validated by
    # hypequery against the dataset, not re-modelled here.
    return StructuredTool.from_function(
        coroutine=run,
        name=definition.name,
        description=definition.description,
        args_schema=to_model_input_schema(definition.input_schema),
        infer_schema=False,
    )


async def hypequery_tools(**source: Unpack[ToolsSource]) -> list[StructuredTool]:
    """List the tools once and return them as LangChain tools.

    A tool error is returned to the model as `{"error": {code, message, hint, ...}}`
    so it can correct itself. A refused token or an unreachable endpoint raises
    `HypequeryToolsError`.
    """

    try:
        import langchain_core  # noqa: F401
    except ImportError as error:
        raise ImportError(
            'hypequery_tools for LangChain needs it: pip install "langchain-core>=0.3.36"'
        ) from error
    client = resolve_tools_client(**source)
    return [_structured_tool(client, definition) for definition in await client.list_tools()]
