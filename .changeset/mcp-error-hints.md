---
'@hypequery/mcp': minor
---

MCP tool errors can carry three optional host fields:

- `hint`: the next action, in one sentence.
- `docsUrl`: a page explaining the failure.
- `requestId`: the host's request id.

Set them through `MCPToolError`'s options, or pass them to `mcpToolErrorFromSemanticFailure`. Every tool's error envelope schema lists them, so MCP SDK clients accept errors that include them.
