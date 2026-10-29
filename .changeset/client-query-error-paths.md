---
'@hypequery/protocol': patch
'@hypequery/datasets': patch
'@hypequery/mcp': patch
---

Strict client-query rejections say where they failed. `validateProtocolClientQuery`
now sets a JSON Pointer on every `HQ_CLIENT_QUERY` error (`/filters/0/value`,
`/orderBy/1/field`, `/grain` for agents) instead of the root for most of them.
Pointers name contract members and item indexes only; an unknown member is still
reported at the root because its name is submitted data. The shared conformance
fixtures pin the pointers for TypeScript and Python.

The typed endpoint schemas from `buildClientContractQuerySchemas` carry the pointer
as the zod issue path, and the MCP HTTP bridge names it in its error message
(`Invalid client query at /filters/0/value.`).
