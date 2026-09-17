---
"@hypequery/deployment": minor
"@hypequery/serve": minor
"@hypequery/cli": minor
---

Build deployment bundles from the canonical deployment contract. `hypequery deployment:build` writes dataset definitions and derived measures without query entrypoints or runtime artifacts. Named queries and standalone metrics remain local. `api.deploymentContract()` is the sole contract source, and bundle verification accepts that contract directly. Remove obsolete build flags, JSON output mode, prebuilt `deploy --release` mode, and customer-handler runtime machinery.
