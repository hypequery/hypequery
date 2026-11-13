---
"@hypequery/agent": minor
---

New package: `mintAgentToken()` signs an end-user token for a hypequery Cloud project's tenant MCP endpoint locally, with one of the project's managed signing keys (EdDSA, `kid` naming the key, audience `hypequery-agent:<project>`, a 15-minute ceiling) and no network call. It returns `{ token, mcpUrl, expiresAt }` and throws `AgentTokenError` naming the option for any input Cloud would refuse. Python's `hypequery.agent.mint_agent_token()` mints the same token for the same input.
