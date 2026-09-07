---
"@hypequery/cli": minor
"@hypequery/serve": minor
---

Add `hypequery mcp`, which serves a project's datasets to an MCP client over
stdio from the same entrypoint `hypequery dev` uses, instead of a second MCP
config that can drift from it.

`--tenant` supplies the trusted tenant; the command fails closed when a
tenant-scoped dataset is registered without one, since MCP has no request to
resolve a tenant from. `--self-test` checks the entrypoint and exits without
speaking the protocol. Application logging is routed to stderr before the
entrypoint is imported, because MCP owns stdout.

`@hypequery/serve` attaches the registered datasets and shared semantic client
to the built API under a registered symbol, readable with
`readServeMcpSource()`.
