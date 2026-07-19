# @hypequery/protocol

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
