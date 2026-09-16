---
"@hypequery/deployment": major
"@hypequery/serve": major
"@hypequery/cli": major
---

Build dataset-only deployment bundles. `hypequery deployment:build` writes the v2 dataset contract, collects no query entrypoints, and produces no runtime artifact; named queries and standalone metrics are reported as local-only before the upload rather than carried. `api.deploymentContract()` is replaced by `api.datasetOnlyContract()`, the `--runtime*` and `--entrypoint-prefix` build flags are removed, and the customer-handler runtime machinery (`createDeploymentHost`, the runtime supervisor, materializer, Node runtime factory, and the named-query data plane) is deleted. Bundle verification reads a stored contract at its own version and exposes a dataset-only projection of it.
