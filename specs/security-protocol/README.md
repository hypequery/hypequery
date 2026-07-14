# Hypequery security protocol

This directory is the public, language-neutral source of truth for the
contracts shared by Hypequery authoring tools, deployment tooling, runtimes,
Studio, and Cloud.

The protocol exists so that independently implemented components can agree on
the meaning, validation, canonical bytes, and identity of an artifact. It does
not make deployment bundles mandatory for self-hosted Serve. Self-hosted Serve
continues to execute project source within its existing trust model.

## Status

The protocol is under active design and has no stable wire version yet.
`@hypequery/protocol` contains draft reference implementations only where a
reviewed proposal has matching language-neutral fixtures. Draft exports do not
establish a stable artifact version.

Do not treat a draft document or the npm package version as an executable
artifact version.

## Authority

The sources have the following roles:

1. Documents in this directory define the normative, language-neutral rules.
2. Language-neutral fixtures prove canonical success and failure behavior.
3. `@hypequery/protocol` is the TypeScript reference implementation.
4. Other language implementations, including Python, implement the same public
   rules and must pass the same fixtures.

If an implementation and the normative specification disagree, the mismatch is
a bug. Implementations must not silently establish competing protocol rules.

## Planned layout

- `decisions/`: accepted architecture and governance decisions.
- `schemas/`: versioned normative schemas and their compatibility rules.
- `fixtures/`: language-neutral canonical inputs, outputs, hashes, and expected
  validation failures.
- `rfc/`: proposals that are not normative until accepted.

Tagged-value and portable-identifier proposals and their draft fixtures live in
`rfc/` and `fixtures/`. Empty directories are introduced only with their first
artifact.

## Boundaries

The protocol may define:

- canonical typed values and artifact identity;
- safe identifier and portable expression structures;
- discovery, deployment bundle, and runtime-reference envelopes;
- compiled-query, error, event, and diagnostic contracts;
- compatibility, limits, and validation failure codes.

The protocol must not contain credentials, runtime secrets, customer callbacks,
database connections, HTTP handlers, authentication implementations, tenant
resolution, billing logic, or Cloud control-plane behavior.

See [Decision 0001](./decisions/0001-protocol-ownership-and-versioning.md) for
ownership and versioning policy.
