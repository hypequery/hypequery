# @hypequery/protocol

Public contracts and the TypeScript reference implementation for portable
Hypequery artifacts.

## Current status

This package now contains the proposed version 1 tagged ClickHouse value codec.
The API remains pre-stable while the language-neutral specification and
conformance fixtures are reviewed. It does not yet define an executable
deployment bundle or a stable Cloud protocol.

The normative source is
[`specs/security-protocol`](../../specs/security-protocol/README.md).

## Scope

The package contains deterministic, framework-independent implementations of
accepted protocol rules. The current implementation provides strict tagged
value validation, RFC 8785 canonical encoding, duplicate-aware decoding, a raw
SHA-256 conformance digest, draft portable logical identifiers, and a proposed
closed dataset expression/query AST. Artifact envelopes and compatibility
checks will follow in separate changes. A closed portable query-schema tree
provides the next layer for named-query input and output contracts.

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

The proposed tagged-value surface exports:

- `validateCanonicalValue`
- `encodeCanonicalValue` and `encodeCanonicalValueToString`
- `decodeCanonicalValue`
- `hashCanonicalValue`
- `ProtocolValueError` and stable error-code types
- tagged-value, option, and limit types

The raw conformance digest is not a deployment identity or shared cache key.
Those domains require separate, versioned, domain-separated contracts.

The proposed identifier surface exports strict parse, guard, split, and join
helpers for simple and dot-qualified logical identifiers. Identifiers are
ASCII, case-sensitive, preserved exactly, and are not SQL identifiers.

The proposed expression surface exports strict validators and immutable types
for derived formulas, comparisons, filtered aggregations, all current dataset
aggregations, and dataset/metric query envelopes. It intentionally excludes raw
SQL and tenant identity; consumers validate names and policy against a dataset
contract before execution.

The proposed schema surface exports strict types and validation for portable
query input/output schemas. It covers the current declarative Serve/Zod schema
features without depending on Zod or embedding executable transforms and
refinements.

## Runtime compatibility

This package is ESM-only. Consumers must load it with `import`; CommonJS
`require()` and a dual ESM/CommonJS build are intentionally out of scope.
Older tools that ignore the package `exports` map and attempt to require the
`main` entry may fail with `ERR_REQUIRE_ESM`.
