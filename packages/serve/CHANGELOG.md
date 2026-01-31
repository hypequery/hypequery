# @hypequery/serve

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
