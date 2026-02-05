# @hypequery/serve

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
