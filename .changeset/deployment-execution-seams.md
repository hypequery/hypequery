---
"@hypequery/deployment": minor
"@hypequery/datasets": minor
---

Serve datasets from the deployment contract. The semantic data plane, operation validation, authorization projection, and portable executor all consume this contract. Standalone metric targets are not deployed. `AuthorizedDeploymentProjection.advertised` is removed; `queryable` now determines whether a dataset appears in the catalog.
