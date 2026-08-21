# @hypequery/protocol

## 0.10.2

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.

## 0.10.1

### Patch Changes

- 6a95ba5: Capture the checked-out Git branch alongside commit and dirty state in deployment source snapshots. Cloud login no longer reads or sends Git branch context; project and environment remain the only deployment-target inputs.

## 0.10.0

### Minor Changes

- 24e0bd5: Capture, verify, upload, and receive multi-file project source snapshots with deployment bundles, including the API entrypoint and optional Git revision provenance.

## 0.9.0

### Minor Changes

- 04abd3c: Add metadata-only query event and privileged query diagnostics validators with closed field sets, size caps, redaction and retention classes, and safe version evolution, per RFC 0011.

## 0.8.0

### Minor Changes

- 7097da6: Add generation-pinned deployment host assembly, bounded Fetch and Node data-plane adapters, duplicate-aware JSON schema parsing, activation-triggered reconciliation, and a reference filesystem host lifecycle.

## 0.7.0

### Minor Changes

- 9a8ac57: Add a reusable protocol schema-value parser and provider-neutral deployment data-plane execution with bounded schema application, access and tenant policy enforcement, portable implementation adapters, typed SQL bindings, and activation-pinned supervised runtime dispatch. Reject ambiguous duplicate named-query routes in deployment contracts.

## 0.6.0

### Minor Changes

- 268818b: Add target-scoped deployment activation with immutable history, atomic
  compare-and-swap semantics, rollback support, and a filesystem reference
  registry.

## 0.5.0

### Minor Changes

- 3a8cad6: Add deterministic target-bound deployment release envelopes and a CLI command
  that prepares them only from fully verified deployment bundles.

## 0.4.0

### Minor Changes

- b92a0a1: Add versioned deployment bundle manifests, canonical identities, deterministic
  bundle directory builds, and strict filesystem verification for deployment and
  runtime artifact bytes.

## 0.3.0

### Minor Changes

- 05d2a4d: Add canonical deployment contract encoding and domain-separated identities, expose deployment generation on Serve APIs, and add CLI build and validation commands for deployment artifacts.

## 0.2.1

### Patch Changes

- 90c02f7: Reject grained deployment metrics whose fixed grain is not included in their supported grains, and require a dataset time field for every grained metric.

## 0.2.0

### Minor Changes

- 28e998f: Add the portable Dataset deployment contract, strict protocol validation, and
  Dataset/Serve adapters for producing deployment artifacts from existing
  definitions.

## 0.1.0

### Minor Changes

- 83847f5: Add the public protocol package scaffold and document ownership, versioning,
  compatibility, and export boundaries for portable Hypequery artifacts.
