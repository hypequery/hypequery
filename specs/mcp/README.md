# MCP parity snapshots

Snapshots that keep `@hypequery/mcp` and a Python MCP server advertising the
same tools. They are generated from the
[client-contract-v1](../security-protocol/fixtures/client-contract-v1/) success
contracts and live here, outside that conformance family, because they are
snapshots rather than case arrays.

- `tool-schemas-v1.json`: per success contract, the `query_dataset` and
  `query_metric` MCP input JSON Schemas and manifest hash (RFC 0018 MCP
  projection). TypeScript generates it (`vitest -u` in `packages/datasets`);
  Python asserts the same bytes.

The snapshot pins the compiler on the raw contract. A server does not compile
that directly: like `@hypequery/mcp` (`mcpClientProfile`), it first applies the
MCP client profile, which clamps `maxLimit` and `maxFilterValues` to at most
1000 and to the host's query limits and re-prepares the contract. So a served
manifest's limits and `manifestHash` can differ from these, and the authorized
contract's `contentHash` is advertised separately.

Regenerate deliberately and review the diff: a change here changes what every
MCP client of both servers sees.
