---
"@hypequery/serve": patch
---

Type `ctx.tenantId` on the query resolver context. The pipeline already set it at runtime when a `tenant` config extracts a tenant ID, but `QueryRuntimeContext` did not declare it, so manual-mode resolvers reading `ctx.tenantId` failed to type-check. Also corrects the `createAuthSystem` JSDoc example, which passed an options object to a function that takes only type parameters.
