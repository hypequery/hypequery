# @hypequery/agent

## 0.1.0

### Minor Changes

- d42525b: New package: `mintAgentToken()` signs an end-user token for a hypequery Cloud project's tenant MCP endpoint locally, with one of the project's managed signing keys (EdDSA, `kid` naming the key, audience `hypequery-agent:<project>`, a 15-minute ceiling) and no network call. `project` and `endpoint` default to the key JSON's `hq_project` and `hq_endpoint`; an explicit option wins. It returns `{ token, mcpUrl, expiresAt }` and throws `AgentTokenError` naming the option for any input Cloud would refuse. Python's `hypequery.agent.mint_agent_token()` mints the same token for the same input.
- 0b50903: New package: `hypequeryTools({ url, token })` puts a tenant MCP endpoint's tools into your own agent loop without an MCP client. Import it from `@hypequery/agent/ai-sdk` (AI SDK tools), `@hypequery/agent/anthropic` (Messages API tool definitions plus `runTool` and `toolResults` for `tool_use` blocks) or `@hypequery/agent/openai-agents` (Agents SDK function tools). Each tool keeps the input schema the server lists. Tool errors reach the model as hypequery's error envelope (code, hint, docsUrl, requestId), and every result's request id is available through `onResult`. `token` can be a function, so short-lived minted tokens refresh. The SDKs are optional peer dependencies. `url` must use https (plain http is allowed for localhost only), so the token is never sent unencrypted.
