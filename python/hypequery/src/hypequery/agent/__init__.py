"""Tenant-safe analytics for your own agent: end-user tokens minted locally.

`mint_agent_token()` is `@hypequery/agent`'s `mintAgentToken()`: it signs a
token for a hypequery Cloud project's tenant MCP endpoint with one of the
project's managed signing keys, with no network call. Both mint the same token
for the same input; `specs/agent-token/fixtures/mint-v1` pins that.

Signing needs `cryptography`, from the `jwt` extra. It is imported when a
token is minted, so this package imports without it.
"""

from __future__ import annotations

from .mint import (
    AGENT_TOKEN_MAX_LIFETIME_SECONDS,
    AgentToken,
    AgentTokenError,
    agent_token_audience,
    mint_agent_token,
)

__all__ = [
    "AGENT_TOKEN_MAX_LIFETIME_SECONDS",
    "AgentToken",
    "AgentTokenError",
    "agent_token_audience",
    "mint_agent_token",
]
