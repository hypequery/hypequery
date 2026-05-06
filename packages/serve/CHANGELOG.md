# @hypequery/serve

## 1.0.0

### Major Changes

- Stable v1.0.0 release. The package is feature-complete with a declarative HTTP server for ClickHouse analytics endpoints, multi-tenant auth (API key, bearer token, role/scope guards), OpenAPI docs, Node.js/fetch/Vercel adapters, CORS, rate limiting, and a full object-style query API with runtime auth parity.

## 0.2.0

### Minor Changes

- 66a6ca4: Expand the current object-style `query({ ... })` API so runtime auth and tenant metadata work the same way as the older builder-first flow.

  - support `auth`, `requiresAuth`, `tenant`, `requiredRoles`, `requiredScopes`, and `custom` directly on object-style query definitions
  - preserve that metadata on standalone queries created via `query({ ... })` so it survives when reused through `serve({ queries })`
  - enforce object-style auth requirements and public routes through the serve runtime
  - include object-style auth metadata in endpoint descriptions and runtime inspection output
  - apply object-style tenant overrides through the serve runtime

  This brings the object-style API closer to feature parity with the builder-first serve path and makes it the clearer default for new integrations.

## 0.1.1

### Patch Changes

- 5c60f20: Add getHeader and apiKeyAuth helpers for header-based auth, plus structured auth errors for missing/invalid credentials.

## 0.1.0

### Minor Changes

- e15ce16: Add per-request header resolvers to React hooks and improve serve multi-tenant ergonomics, ESM-safe startup, and docs alignment.

### Patch Changes

- ed06077: Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.

## 0.0.9

### Patch Changes

- Republish so CI builds `dist` output before publishing and the package ships compiled files.

## 0.1.0

### Minor Changes

- 3a2aaea: Implement auth guard enhancements with type-safe authorization. Add `createAuthSystem` for compile-time role/scope safety, shared authorization validators (`checkRoleAuthorization`, `checkScopeAuthorization`), comprehensive integration tests, and OpenAPI documentation for auth requirements. Mark middleware functions (`requireAuthMiddleware`, `requireRoleMiddleware`, `requireScopeMiddleware`) as deprecated in favor of the declarative guard API.

## 0.0.7

### Patch Changes

- 4bbab53: Enable query execution stats logging in dev server. Removed "Coming soon!" placeholder as the feature is already implemented via `serveDev`.

## 0.0.6

### Patch Changes

- 5acbaf3: Fix validation for queries with void input schema.

  The `buildContextInput` function now correctly returns `undefined` instead of an empty object `{}` for requests with no body or query parameters. This fixes a bug where queries using `z.void()` input validation would fail with "Expected void, received object" errors.

  **Changes:**

  - Fixed `buildContextInput` in `pipeline.ts` to return `undefined` for empty requests
  - Added test to prevent future regressions
  - Updated vite-starter example to display validation errors in UI

## 0.0.4

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
