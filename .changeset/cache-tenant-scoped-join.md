---
'@hypequery/datasets': patch
---

Fix a cross-tenant result-cache collision when a tenant-less base dataset joins a tenant-scoped relationship target. The cache signature derived its tenant partition only from the base dataset's `tenantKey`, but relationship joins apply the runtime tenant predicate whenever the *target* is tenant-scoped — so two runtime tenants running the same query against a tenant-less base could share one cache entry and be served each other's joined, tenant-filtered rows. The signature now partitions per tenant whenever a query activates a tenant-scoped join, while tenant-less queries that touch no tenant-scoped target still share entries as before.
