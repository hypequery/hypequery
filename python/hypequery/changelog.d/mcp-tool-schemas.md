- `hypequery.protocol.build_client_contract_tool_schemas()` compiles a signed
  client contract into the `query_dataset` and `query_metric` MCP tool input
  schemas, identical to `@hypequery/datasets`'s, plus the manifest hash. It is
  the schema layer for a future Python MCP server; Python APIs still reach
  agents through `@hypequery/mcp`.
