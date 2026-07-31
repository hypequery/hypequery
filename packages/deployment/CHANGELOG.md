# @hypequery/deployment

## 0.7.1

### Patch Changes

- Updated dependencies [6a95ba5]
  - @hypequery/protocol@0.10.1

## 0.7.0

### Minor Changes

- 24e0bd5: Capture, verify, upload, and receive multi-file project source snapshots with deployment bundles, including the API entrypoint and optional Git revision provenance.

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0

## 0.6.0

### Minor Changes

- ce908d8: Add asynchronous, snapshot-specific environment resolution to the reference
  Node worker factory so providers can isolate deployment credentials without
  mutating shared process state.

## 0.5.1

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0

## 0.5.0

### Minor Changes

- 7097da6: Add generation-pinned deployment host assembly, bounded Fetch and Node data-plane adapters, duplicate-aware JSON schema parsing, activation-triggered reconciliation, and a reference filesystem host lifecycle.

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/protocol@0.8.0

## 0.4.0

### Minor Changes

- 9a8ac57: Add a reusable protocol schema-value parser and provider-neutral deployment data-plane execution with bounded schema application, access and tenant policy enforcement, portable implementation adapters, typed SQL bindings, and activation-pinned supervised runtime dispatch. Reject ambiguous duplicate named-query routes in deployment contracts.

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/protocol@0.7.0

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
