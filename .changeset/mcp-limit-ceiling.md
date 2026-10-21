---
'@hypequery/datasets': patch
'@hypequery/protocol': patch
'@hypequery/mcp': patch
---

MCP tools refuse a `limit` above the endpoint's `maxLimit` with `MCP_INVALID_ARGUMENTS` instead of silently clamping it, so an agent never mistakes a shortened page for the whole answer. Tool schemas built from a client contract advertise that ceiling as the `limit` maximum, and `validateProtocolClientQuery(..., 'mcp')` enforces it. HTTP requests keep clamping, as both Serve implementations do.
