# @hypequery/react

## 1.0.0

### Major Changes

- Stable v1.0.0 release. The package is feature-complete with full type-safe React Query hooks for consuming hypequery serve APIs, comprehensive error handling, custom fetch and header support, and support for React 18 and 19.

## 0.1.1

### Patch Changes

- 5c60f20: Allow headers to return an empty object and ignore undefined values.

## 0.1.0

### Minor Changes

- e15ce16: Add per-request header resolvers to React hooks and improve serve multi-tenant ergonomics, ESM-safe startup, and docs alignment.

### Patch Changes

- ed06077: Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.
- 651f1c0: Ensure React package builds on publish by running `pnpm build` before packing and verifying required dist artifacts.

## 0.0.3

### Patch Changes

- Republish to ensure the release pipeline builds and ships compiled `dist` files.

## 0.0.2

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
