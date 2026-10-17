---
"@hypequery/mcp": minor
---

Add an HTTP MCP executor over authorized Python client contracts, retaining
endpoint-specific query permissions and schema pins. Bound discovery, tool
manifests, streamed JSON results and execution time; reject redirects, stale
views, private metadata and result fields outside the requested projection.
Existing local and discovery-only executors remain supported.
`MCPToolExecutor.listTools`, `listPrompts` and `getPrompt` accept an optional
cancellation signal, which the protocol server now forwards from each request.
