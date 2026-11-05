# MCP parity snapshots

Snapshots that pin the TypeScript and Python MCP schema compilers to the same
output, so a Python MCP server can advertise the same tools as `@hypequery/mcp`.
Python has no MCP server yet; today a Python API reaches agents through
`@hypequery/mcp`'s HTTP executor. The snapshots are generated from the
[client-contract-v1](../security-protocol/fixtures/client-contract-v1/) success
contracts and live here, outside that conformance family, because they are
snapshots rather than case arrays.

- `tool-schemas-v1.json`: per success contract, the `query_dataset` and
  `query_metric` MCP input JSON Schemas and manifest hash (RFC 0018 MCP
  projection), compiled from the contract as given. TypeScript generates it
  (`vitest -u` in `packages/datasets`); Python asserts the same bytes.

The snapshot pins the compiler, not what a server advertises. `@hypequery/mcp`
first narrows the contract with `mcpClientProfile`
(`packages/mcp-server/src/utils/http-client/profile.ts`): it lowers each
endpoint's limits to the host's configured query limits and to at most 1000
rows and filter values, then re-prepares the contract, so its manifest hash
differs from the backend's. A Python server must apply the same profile before
compiling, or it will advertise larger limits and a different manifest hash
than the Node server for the same backend.

Regenerate deliberately and review the diff: a change here changes what every
MCP client of both servers sees.
