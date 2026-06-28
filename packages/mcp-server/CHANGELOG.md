# @hypequery/mcp

## 0.4.0

### Minor Changes

- 236ce16: Add catalog-backed semantic tool generation and harden SQL exposure across MCP and generated tools.

  `@hypequery/datasets`:

  - Add `generateDatasetTools` with `catalog`, `per-dataset`, and `per-metric` modes, plus `toOpenAITools`, `toAISDKTools`, and `toMcpTools` adapters. Generated tools validate agent inputs against catalog metadata and redact SQL from results by default.
  - Expand the dataset catalog with default filter operators, filter value types, supported time grains, tenant requirement, orderable fields, max result limit, and measure filter counts.
  - Export `SEMANTIC_FILTER_OPERATORS` and `SUPPORTED_TIME_GRAINS` and use the shared operator list across packages.

  `@hypequery/serve`:

  - Build semantic input schemas and endpoint descriptions from catalog metadata, including supported grains, filters, relationships, and tenant scoping.

  `@hypequery/mcp`:

  - Distinguish measures from named metrics in dataset listing and introspection (`metricCount` no longer falls back to the measure count).
  - Add an `includeSql` server option (default `false`) so `get_dataset_schema`, `query_dataset`, and `query_metric` no longer expose generated SQL to agents unless explicitly enabled for trusted debugging.

### Patch Changes

- Updated dependencies [236ce16]
  - @hypequery/datasets@0.3.0

## 0.3.0

### Minor Changes

- e6734be: Add dataset catalog metadata for measures, filters, relationships, limits, and attached named metrics. Update MCP dataset introspection and dataset querying metadata to distinguish measures from named metrics.

  Breaking MCP change: `query_dataset` now accepts `measures` only. The previous `metrics` argument for dataset queries has been removed so named metrics remain reserved for `query_metric`.

### Patch Changes

- Updated dependencies [e6734be]
  - @hypequery/datasets@0.2.1

## 0.2.0

### Minor Changes

- 75349dd: Move MCP metric and dataset tools onto the unified `DatasetClient` runtime.

  Query arguments are now validated consistently, tenant-scoped datasets require
  a trusted server-side `tenantId`, and explicit tenant-filter overrides are
  rejected. Metric and dataset responses also expose pagination metadata so MCP
  clients can continue querying while `hasMore` is true.

### Patch Changes

- Updated dependencies [ad42b98]
- Updated dependencies [75349dd]
- Updated dependencies [69b67c0]
- Updated dependencies [2f3c293]
- Updated dependencies [278924e]
  - @hypequery/datasets@0.2.0
