---
"@hypequery/datasets": minor
"@hypequery/serve": minor
"@hypequery/mcp": minor
---

Add catalog-backed semantic tool generation and harden SQL exposure across MCP and generated tools.

`@hypequery/datasets`:
- Add `generateDatasetTools` with `catalog`, `per-dataset`, and `per-metric` modes, plus `toOpenAITools`, `toAISDKTools`, and `toMcpTools` adapters. Generated tools validate agent inputs against catalog metadata and redact SQL from results by default.
- Expand the dataset catalog with default filter operators, filter value types, supported time grains, tenant requirement, orderable fields, max result limit, and measure filter counts.
- Export `SEMANTIC_FILTER_OPERATORS` and `SUPPORTED_TIME_GRAINS` and use the shared operator list across packages.

`@hypequery/serve`:
- Build semantic input schemas and endpoint descriptions from catalog metadata, including supported grains, filters, relationships, and tenant scoping.

`@hypequery/mcp`:
- Distinguish measures from named metrics in dataset listing and introspection (`metricCount` no longer falls back to the measure count).
- Add an `includeSql` server option (default `false`) so `get_dataset_schema`, `query_dataset`, and `query_metric` no longer expose generated SQL to agents unless explicitly enabled for trusted debugging.
