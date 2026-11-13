---
"@hypequery/agent": minor
---

New package: `hypequeryTools({ url, token })` puts a tenant MCP endpoint's tools into your own agent loop without an MCP client. Import it from `@hypequery/agent/ai-sdk` (AI SDK tools), `@hypequery/agent/anthropic` (Messages API tool definitions plus `runTool` and `toolResults` for `tool_use` blocks) or `@hypequery/agent/openai-agents` (Agents SDK function tools). Each tool keeps the input schema the server lists. Tool errors reach the model as hypequery's error envelope (code, hint, docsUrl, requestId), and every result's request id is available through `onResult`. `token` can be a function, so short-lived minted tokens refresh. The SDKs are optional peer dependencies.
