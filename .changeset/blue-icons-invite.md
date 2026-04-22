---
'@hypequery/serve': minor
---

Expand the current object-style `query({ ... })` API so runtime auth and tenant metadata work the same way as the older builder-first flow.

- support `auth`, `requiresAuth`, `tenant`, `requiredRoles`, `requiredScopes`, and `custom` directly on object-style query definitions
- preserve that metadata on standalone queries created via `query({ ... })` so it survives when reused through `serve({ queries })`
- enforce object-style auth requirements and public routes through the serve runtime
- include object-style auth metadata in endpoint descriptions and runtime inspection output
- apply object-style tenant overrides through the serve runtime

This brings the object-style API closer to feature parity with the builder-first serve path and makes it the clearer default for new integrations.
