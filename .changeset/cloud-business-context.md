---
"@hypequery/protocol": minor
"@hypequery/datasets": minor
"@hypequery/deployment": minor
"@hypequery/cli": minor
---

Publish reviewed business context (summary, KPIs, glossary, conventions, caveats) to Cloud alongside the deployment contract.

- `@hypequery/protocol`: new `BusinessContextV1` document with strict validation and a canonical identity, and deployment bundle manifest version 2, which adds a required `businessContext` file entry. Bundles without context remain version 1, so existing bundle identities are unchanged.
- `@hypequery/datasets`: `defineBusinessContext` and `defineCloudPublication({ deployment, businessContext })`. Bare `publishToCloud(...)` exports keep working.
- `@hypequery/deployment`: bundle verification and intake accept version 1 and version 2 bundles; verified bundles expose `businessContext`. New `deploymentBundleFiles` helper defines the shared file order for upload, intake and storage.
- `@hypequery/cli`: `deployment:build` and `deploy` write business context into the bundle and upload it. A glossary-only change produces a new bundle and release identity.

Deploying a version 2 bundle requires a Cloud control plane on this `@hypequery/deployment` release or later.
