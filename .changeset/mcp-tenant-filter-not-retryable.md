---
"@hypequery/mcp": patch
---

A tenant-scoped caller that filters on a dataset's tenant field in `query_dataset` or `query_metric` now gets `MCP_INVALID_ARGUMENTS` (`correctable_input`, `retryable: false`, `relist: false`, `reason: "MCP_TENANT_FIELD_NOT_FILTERABLE"`) with a hint to remove the filter, instead of a retryable `MCP_EXECUTION_FAILED`. The tenant is fixed by the caller's credential, so retrying could never succeed. Grouping by the tenant field and refusing tenant arguments are unchanged.
