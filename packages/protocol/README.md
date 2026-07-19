# @hypequery/protocol

Public contracts and the TypeScript reference implementation for portable
Hypequery artifacts.

## Current status

This package contains proposed version 1 tagged values, identifiers,
expressions, query schemas and implementations, Dataset deployment contracts,
and deployment bundle manifests. The API remains pre-stable while the
language-neutral specifications and conformance fixtures are reviewed; these
drafts do not yet establish a stable Cloud protocol.

The normative source is
[`specs/security-protocol`](../../specs/security-protocol/README.md).

## Scope

The package contains deterministic, framework-independent implementations of
accepted protocol rules. The current implementation provides strict tagged
value validation, RFC 8785 canonical encoding, duplicate-aware decoding,
portable logical identifiers, closed expression and schema trees, query
implementation artifacts, and a validated deployment envelope with a
domain-separated identity.

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
aggregations, and dataset/metric query envelopes. It intentionally excludes
caller-supplied SQL and tenant identity; consumers validate names and policy
against a dataset contract before execution.

The proposed schema surface exports strict types and validation for portable
query input/output schemas. It covers the current declarative Serve/Zod schema
features without depending on Zod or embedding executable transforms and
refinements. The reusable schema-value parser applies defaults and unknown
property policy to bounded plain wire values and returns detached immutable
values for execution adapters.

The proposed query-implementation surface keeps trusted implementation details
separate from public query intent. It covers Dataset SQL expressions, fixed
semantic plans, compiled read-only ClickHouse statements with bound input or
tenant parameters, and hashed Node/Python runtime references for Serve handlers
that cannot be lowered portably. Validation does not execute or authorize SQL.

The proposed deployment surface combines complete Dataset definitions, named
Serve queries, endpoint policy, and runtime artifact identities into one strict
versioned envelope. Dataset and Serve adapters live in their owning packages;
the protocol package remains deterministic and framework-independent.
Validated envelopes can be encoded as canonical RFC 8785 bytes and identified
with the deployment-v1 domain-separated SHA-256 digest.

The proposed deployment-bundle surface validates the portable manifest that
binds a deployment identity to exact deployment and runtime artifact files. It
provides canonical encoding and a separate bundle-v1 identity. Filesystem-safe
writing remains in the CLI, while reusable filesystem verification and
receiving-side intake live in `@hypequery/deployment`; this package performs no
I/O.

The proposed deployment-release surface binds one verified bundle identity to
an explicit project and environment. Its deterministic identity serves as the
idempotency key for authenticated deployment submission without putting
credentials, timestamps, release state, or provider behavior into the envelope.

## Runtime compatibility

This package is ESM-only. Consumers must load it with `import`; CommonJS
`require()` and a dual ESM/CommonJS build are intentionally out of scope.
Older tools that ignore the package `exports` map and attempt to require the
`main` entry may fail with `ERR_REQUIRE_ESM`.
