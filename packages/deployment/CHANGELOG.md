# @hypequery/deployment

## 0.3.0

### Minor Changes

- 3de49ce: Add a provider-neutral deployment HTTP control plane with authenticated target
  activation, current-state and bounded-history reads, and streaming Fetch and
  Node adapters.
- eb5faec: Add active-release runtime materialization with closed-bundle revalidation,
  copy-on-read artifacts, deterministic query bindings, and activation stability
  checks.
- 35af6f4: Add readiness-gated runtime supervision with atomic generation switching,
  in-flight draining, named-query invocation, and a reference Node worker factory.

## 0.2.0

### Minor Changes

- 268818b: Add target-scoped deployment activation with immutable history, atomic
  compare-and-swap semantics, rollback support, and a filesystem reference
  registry.
- 7afcf16: Add a content-addressed filesystem submission store with atomic publication,
  safe idempotent replay, stored-state verification, and partial-write recovery.

### Patch Changes

- Updated dependencies [268818b]
  - @hypequery/protocol@0.6.0
