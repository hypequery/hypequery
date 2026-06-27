# @hypequery/mcp

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
