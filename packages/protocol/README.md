# @hypequery/protocol

`@hypequery/protocol` is the deterministic TypeScript reference implementation for Hypequery’s portable, language-neutral artifacts. It validates and canonically encodes semantic expressions, query schemas, deployment contracts, bundle manifests, release envelopes, query events, and diagnostics without connecting to a database or executing user code.

The normative source is [`specs/security-protocol`](../../specs/security-protocol/README.md). The package is pre-stable while the draft wire contracts and conformance fixtures are reviewed; the npm version is not an artifact version.

## What the protocol solves

Hypequery authoring tools, deployment systems, runtimes, and implementations in different languages need to agree on four things:

1. which values and structures are accepted;
2. the exact canonical bytes for an accepted artifact;
3. the stable identity derived from those bytes;
4. the failure code returned for rejected input.

This package implements those rules in TypeScript. Python and other implementations are tested against the same fixtures with `@hypequery/protocol-conformance`.

## Main surfaces

- canonical tagged values and RFC 8785 encoding
- strict simple and qualified logical identifiers
- closed semantic expression and query envelopes
- portable input and output schemas
- trusted query implementation artifacts
- dataset and named-query deployment contracts
- closed deployment bundle manifests
- project/environment release envelopes
- compiled query settings, cancellation, events, and diagnostics

The package performs no filesystem or network I/O. It does not load project source, choose credentials, connect to ClickHouse, authenticate users, resolve tenants, or host HTTP routes. Those jobs remain with the CLI, deployment package, and runtime adapters.

## Canonical values

The root export includes validation, encoding, decoding, hashing, errors, and the related immutable types:

```ts
import {
  validateCanonicalValue,
  encodeCanonicalValueToString,
  decodeCanonicalValue,
  hashCanonicalValue,
  ProtocolValueError,
} from '@hypequery/protocol';
```

Domain-specific identities remain separate. A raw canonical-value digest is not automatically a deployment, bundle, release, or cache identity.

## Portable analytics definitions

Expression validators cover derived formulas, comparisons, filtered aggregates, the full dataset aggregation surface, and metric/dataset query envelopes. Runtime callers provide semantic names and values; they cannot embed SQL or tenant identity in these portable query structures.

Schema validators cover the declarative Serve/Zod features that can travel between runtimes without importing Zod or executable refinements. Schema application handles defaults and unknown properties on bounded wire values.

## Deployment artifacts

A deployment combines dataset definitions, named Serve queries, endpoint policy, and runtime artifact identities in one strict versioned envelope. Bundle manifests bind that deployment and every runtime file by path, byte length, and hash. Release envelopes bind a verified bundle to one explicit project and environment.

Canonical encoders and domain-separated SHA-256 identities make these artifacts reproducible across language implementations. Filesystem-safe construction and verification live in `@hypequery/deployment` and the CLI.

## Package use

Only the root package export is public. Package SemVer and protocol versions are deliberately separate. The package is ESM-only and must be loaded with `import`.

Self-hosted `@hypequery/serve` can continue to run application source directly. Portable deployment bundles are needed for deployment, compatibility checks, and cross-runtime handoff—not for ordinary local query execution.

## License

Apache-2.0.
