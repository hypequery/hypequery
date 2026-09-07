---
"@hypequery/protocol": minor
---

Require dataset and endpoint tenancy to agree in both directions in a deployment
contract. The contract already refused to publish a tenant-scoped dataset
through an endpoint that does not require a tenant; it now also refuses the
reverse, where an endpoint requires a tenant over a dataset that declares no
field to scope by.

That shape resolves a tenant and then has no column to filter on, so the query
reads every tenant's rows while the endpoint reports tenancy as enforced. Named
queries with a compiled-SQL implementation have always been validated in both
directions; datasets and metrics now match.

A contract of that shape is rejected with `HQ_DEPLOYMENT_INVALID_REFERENCE` at
`$.datasets[i].endpoint.tenant` or `$.datasets[i].metrics[j].endpoint.tenant`.
