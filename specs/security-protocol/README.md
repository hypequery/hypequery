# Hypequery security protocol

This directory is the language-neutral source of truth for portable Hypequery analytics and deployment artifacts.

The protocol lets TypeScript, Python, authoring tools, deployment systems, and runtimes agree on accepted values, exact canonical bytes, stable identities, and failure codes. It does not change how self-hosted `@hypequery/serve` runs trusted application source.

## Status

The protocol is under active design and has no stable wire version. A draft RFC, fixture family, or npm package version is not automatically a stable artifact version.

## Order of authority

1. Accepted language-neutral specifications define behavior.
2. Fixtures pin success values, identities, and failure codes.
3. `@hypequery/protocol` is the TypeScript reference implementation.
4. Python and other implementations must pass the same fixtures.

A disagreement between an implementation and an accepted specification is a bug.

## Layout

- `decisions/` records accepted governance and architecture decisions.
- `rfc/` contains proposals and versioned contract definitions.
- `fixtures/` contains language-neutral conformance cases and their [update
  runbook](./fixtures/README.md).
- schemas are introduced with the specifications that own them.

## Boundary

The protocol may define canonical values, identifiers, expressions, query schemas, deployment envelopes, runtime references, events, diagnostics, limits, and stable error codes.

It does not contain credentials, secrets, customer callbacks, database connections, HTTP handlers, authentication implementations, tenant resolution, billing logic, or Cloud control-plane behavior.

See [Decision 0001](./decisions/0001-protocol-ownership-and-versioning.md) for ownership and versioning policy and [`@hypequery/protocol-conformance`](../../packages/protocol-conformance/README.md) for cross-language testing.
