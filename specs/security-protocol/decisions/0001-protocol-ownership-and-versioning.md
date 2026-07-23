# Decision 0001: Protocol ownership and versioning

- Status: Accepted
- Date: 2026-07-13
- Owners: Hypequery maintainers

## Context

Datasets, ClickHouse, Serve, the CLI, Python, and Cloud need to exchange
portable artifacts without assigning different meanings to the same bytes.
Duplicating canonical encoding, validation, identifier rules, or artifact
schemas inside each product package would make cross-language identity and
security behavior drift.

The shared contract also forms part of the deployed security boundary. Users
must be able to inspect it, implement it independently, and reproduce the
validation and hashing performed by hosted services.

## Decision

The normative protocol specification and conformance fixtures are maintained
publicly under `specs/security-protocol/` in this Apache-2.0 repository.

The public `@hypequery/protocol` package is the TypeScript reference
implementation. It contains only deterministic contract primitives: types,
strict parsers and validators, canonical encoders and decoders, digest helpers,
and version compatibility checks that implement accepted specifications.

Product packages consume these primitives but do not redefine them. A Python
implementation does not depend on Node; it implements the same normative rules
and must pass the shared language-neutral fixtures.

The protocol package does not own SQL execution, database connections,
authentication, tenant resolution, HTTP routing, UI behavior, deployment
operations, or Cloud control-plane logic.

## Version domains

Four versions have different jobs and must not be conflated:

1. **Package version:** npm SemVer for `@hypequery/protocol` implementation
   releases. It describes library compatibility, not artifact identity.
2. **Core protocol version:** identifies frozen rules whose interpretation
   affects canonical bytes, hashes, deployment acceptance, parameter typing, or
   identifier meaning. An incompatible change requires a new core version and
   hash domain.
3. **Artifact schema version:** discovery documents, deployment bundles, runtime
   configuration references, events, errors, and diagnostics evolve under
   their own explicitly declared schemas. One artifact cannot infer its version
   from another artifact or from the installed npm version.
4. **Implementation version:** product and language package versions are useful
   diagnostics but never substitute for an artifact's declared versions.

No stable core or artifact schema version is assigned by this scaffold.

## Compatibility policy

- Parsers fail closed on unknown core versions and unknown security-relevant
  fields. They never guess a newer interpretation.
- Frozen-core changes require an explicit new core version, canonical fixtures,
  migration notes, and compatibility tests.
- Evolvable metadata may add fields only where its schema explicitly defines
  forward behavior. Security meaning cannot change through an additive field.
- A producer must emit one declared version. A consumer must report the
  unsupported version and required upgrade without partially executing it.
- Canonical fixtures are normative. Every supported language must produce the
  same bytes and hashes and the same stable failure codes.
- Pre-stable `0.x` npm releases may change library APIs, but they may not
  silently reinterpret an already published artifact version.

## Public export policy

- Only exports declared by `packages/protocol/package.json` are public.
- The root export is the initial and preferred public surface. Internal source
  paths are not supported API.
- Runtime exports require an accepted normative document and matching fixtures.
- Framework adapters and product conveniences belong in their owning packages,
  even when they consume protocol types.
- The initial scaffold intentionally has no runtime exports and defines no
  executable artifact schema.

## Self-hosting and open-core boundary

The protocol and its reference implementation remain public. Bundles are a
Cloud deployment boundary and may be used for local diagnostics; they are not
a mandatory intermediate for self-hosted Serve. Trusted raw SQL and custom
handlers remain available under the existing self-hosted trust model.

Cloud may charge for managed deployment, isolation, secrets, operations,
scaling, and support. It must not make the public artifact semantics or the
ability to validate a bundle proprietary.

## Consequences

- Protocol changes require deliberate review and conformance evidence.
- TypeScript and Python can evolve independently without semantic drift.
- CLI tooling can diagnose Cloud compatibility locally.
- Cloud can revalidate uploads instead of trusting producer behavior.
- The package remains smaller than the products that consume it.
