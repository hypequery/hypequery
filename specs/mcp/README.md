# MCP parity snapshots

Snapshots that keep `@hypequery/mcp` and the Python `hypequery mcp` server
advertising the same tools. They are generated from the
[client-contract-v1](../security-protocol/fixtures/client-contract-v1/) success
contracts and live here, outside that conformance family, because they are
snapshots rather than case arrays.

- `tool-schemas-v1.json`: per success contract, the `query_dataset` and
  `query_metric` MCP input JSON Schemas and manifest hash (RFC 0018 MCP
  projection). TypeScript generates it (`vitest -u` in `packages/datasets`);
  Python asserts the same bytes.
- `bridge-manifests-v1.json`: per success contract, the HTTP bridge's
  `tools/list` result at default host limits, query input schemas elided (they
  are tool-schemas-v1.json's, from the profiled contract). TypeScript generates
  it (`vitest -u` in `packages/mcp-server`); Python's `hypequery mcp` asserts
  the same bytes.

Regenerate deliberately and review the diff: a change here changes what every
MCP client of both servers sees.
