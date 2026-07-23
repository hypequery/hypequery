---
'@hypequery/datasets': patch
---

Fix tenant isolation when a tenant-less base dataset joins a tenant-scoped
relationship target. Joined results are now partitioned per runtime tenant in
the result cache, and queries that activate a tenant-scoped relationship must
provide a runtime tenant or the explicit trusted cross-tenant scope. Queries
that touch no tenant-scoped target continue to share cache entries as before.
