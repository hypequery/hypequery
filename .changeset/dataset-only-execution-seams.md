---
"@hypequery/deployment": major
"@hypequery/datasets": major
---

Serve dataset targets only. The semantic data plane, its contract-driven operation validation, the authorization projection, and the portable executor all take the dataset-only contract; a metric target is refused as not found rather than resolved. `AuthorizedDeploymentProjection.advertised` is gone — with no metric to carry, a dataset earns a place in the catalog on the same terms it earns one as a `query_dataset` target, so `queryable` is the whole answer.
