---
"@hypequery/mcp": minor
---

Move MCP metric and dataset tools onto the unified `DatasetClient` runtime.

Query arguments are now validated consistently, tenant-scoped datasets require
a trusted server-side `tenantId`, and explicit tenant-filter overrides are
rejected. Metric and dataset responses also expose pagination metadata so MCP
clients can continue querying while `hasMore` is true.
