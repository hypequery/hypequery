# @hypequery/protocol

Public contracts and the TypeScript reference implementation for portable
Hypequery artifacts.

## Current status

This package is an intentionally empty public scaffold. It does not yet define
a stable protocol or an executable deployment bundle. Runtime exports will be
added incrementally after their language-neutral specifications and conformance
fixtures are accepted.

The normative source is
[`specs/security-protocol`](../../specs/security-protocol/README.md).

## Intended scope

The package will contain deterministic, framework-independent implementations
of accepted protocol rules, including strict validation, canonical encoding,
digest calculation, identifiers, portable AST structures, artifact envelopes,
and compatibility checks.

It will not connect to ClickHouse, execute queries, load project source, access
credentials or the environment, perform network or filesystem I/O, implement
authentication or tenancy, or contain CLI, HTTP, UI, and Cloud operations.

Self-hosted Serve continues to run project source directly. Deployment bundles
are required only by Cloud deployment and may be generated ephemerally for
Studio compatibility and security diagnostics.

## Public API

Only the root package export is public. Deep imports from `src` or `dist` are
unsupported. Package SemVer and protocol/artifact versions are separate; an
installed npm version never determines an artifact's identity.
