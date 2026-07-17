# @hypequery/mcp

## 0.5.3

### Patch Changes

- Updated dependencies [28e998f]
  - @hypequery/datasets@0.12.0

## 0.5.2

### Patch Changes

- Updated dependencies [a84beb8]
  - @hypequery/datasets@0.11.0

## 0.5.1

### Patch Changes

- Updated dependencies [379998a]
  - @hypequery/datasets@0.10.0

## 0.5.0

### Minor Changes

- b6b5111: Relationship-aware semantics: to-one relationships are now queryable end to end, and every metadata surface advertises them.

  **Querying (`@hypequery/datasets`, `@hypequery/clickhouse`):** dataset and metric queries can select, filter, and order by to-one related fields one hop deep (`dimensions: ['customer.country']`). Traversal executes as a ClickHouse `LEFT ANY JOIN` (new `leftAnyJoin` query-builder method), so base rows survive, duplicate target join keys can never fan out aggregates, and production matches the in-memory backend's first-match semantics. When runtime tenancy is active, joined targets with a `tenantKey` are scoped inside the join condition. `hasMany` remains metadata-only, and result row types include qualified fields (`row['customer.country']` is typed).

  **Metadata:** the catalog and semantic contract expose `queryable` and `fields` per relationship (replacing `execution: 'metadata_only'`; `SEMANTIC_CONTRACT_VERSION` is now 2). Generated agent tools, Serve's Zod/OpenAPI input schemas, and MCP `get_dataset_schema` all advertise the same qualified field names the validators accept — including for config-shaped datasets in MCP. Serve no longer advertises dimensions as filterable when a dataset explicitly declares `filters: {}`.

  **Validation:** `dataset()` now rejects relationship names that match the dataset's source table (the join alias would shadow the base table) or contain dots — both configurations previously failed confusingly at query time.

  **Deprecations (no removals, no behavior changes):** the plan/backend execution path is frozen in favor of `createDatasetClient({ queryBuilder })`. `createBackend`, the `backend` client option, `createInMemoryBackend`, and the `PlanNode`/`SemanticBackend` protocol exports are `@deprecated` and receive bug fixes only.

### Patch Changes

- Updated dependencies [b6b5111]
  - @hypequery/datasets@0.9.0

## 0.4.5

### Patch Changes

- Updated dependencies [53f6149]
  - @hypequery/datasets@0.8.0

## 0.4.4

### Patch Changes

- Updated dependencies [4fed0a7]
  - @hypequery/datasets@0.7.0

## 0.4.3

### Patch Changes

- Updated dependencies [98ad4b6]
  - @hypequery/datasets@0.6.0

## 0.4.2

### Patch Changes

- Updated dependencies [d7259f0]
  - @hypequery/datasets@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [12ee5e6]
  - @hypequery/datasets@0.4.0

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
