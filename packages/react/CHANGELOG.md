# @hypequery/react

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
