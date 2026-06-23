# @hypequery/mcp

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
