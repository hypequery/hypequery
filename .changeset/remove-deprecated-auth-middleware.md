---
"@hypequery/serve": minor
---

Implement auth guard enhancements with type-safe authorization. Add `createAuthSystem` for compile-time role/scope safety, shared authorization validators (`checkRoleAuthorization`, `checkScopeAuthorization`), comprehensive integration tests, and OpenAPI documentation for auth requirements. Mark middleware functions (`requireAuthMiddleware`, `requireRoleMiddleware`, `requireScopeMiddleware`) as deprecated in favor of the declarative guard API.
