"""Tenant-safe analytics for your own agent: tools for your agent framework, and
end-user tokens minted locally.

The tools come from an executor in this process (`executor=`) or a tenant MCP
endpoint such as hypequery Cloud's (`url=` and `token=`), as native tools for
Anthropic (`hypequery.agent.anthropic`), the OpenAI Agents SDK
(`hypequery.agent.openai_agents`) and Pydantic AI (`hypequery.agent.pydantic_ai`).
They mirror `@hypequery/agent`: the same tools, schemas and error envelope.

`mint_agent_token()` is `@hypequery/agent`'s `mintAgentToken()`: it signs a
token for a hypequery Cloud project's tenant MCP endpoint with one of the
project's managed signing keys, with no network call. Both mint the same token
for the same input; `specs/agent-token/fixtures/mint-v1` pins that.

Signing needs `cryptography`, from the `jwt` extra. It is imported when a
token is minted, so this package imports without it.
"""

from __future__ import annotations

from .clients.executor import ExecutorToolsClient
from .clients.remote import RemoteToolsClient
from .errors import HypequeryToolsError
from .mint import (
    AGENT_TOKEN_MAX_LIFETIME_SECONDS,
    AgentToken,
    AgentTokenError,
    agent_token_audience,
    mint_agent_token,
)
from .source import ToolsSource, resolve_tools_client
from .types import (
    OnResult,
    Token,
    ToolDefinition,
    ToolErrorDetails,
    ToolExecutor,
    ToolFailure,
    ToolResult,
    ToolsClient,
    ToolSuccess,
)
from .utils.results import REQUEST_ID_META_KEY, to_model_output

__all__ = [
    "AGENT_TOKEN_MAX_LIFETIME_SECONDS",
    "REQUEST_ID_META_KEY",
    "AgentToken",
    "AgentTokenError",
    "ExecutorToolsClient",
    "HypequeryToolsError",
    "OnResult",
    "RemoteToolsClient",
    "Token",
    "ToolDefinition",
    "ToolErrorDetails",
    "ToolExecutor",
    "ToolFailure",
    "ToolResult",
    "ToolSuccess",
    "ToolsClient",
    "ToolsSource",
    "agent_token_audience",
    "mint_agent_token",
    "resolve_tools_client",
    "to_model_output",
]
