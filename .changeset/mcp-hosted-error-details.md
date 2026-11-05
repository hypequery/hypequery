---
'@hypequery/mcp': minor
---

Hosted error details on MCP tool errors: `MCPToolError` and its published error envelope carry optional `retryAfterSeconds`, `relist` and `reason` (a host's own stable code), and a new `MCP_RATE_LIMITED` code (category `budget`, retryable). `mcpToolErrorFromSemanticFailure` maps a semantic data-plane failure to the MCP error an agent receives, and `createMCPErrorResponse` is exported so hosts build tool errors exactly as the local server does.
