# RFC 0008: Deployment release envelope

- Status: Proposed
- Version: deployment release 1

## Summary

This RFC defines the deterministic request that assigns one verified RFC 0007
deployment bundle to an explicit project and environment. It is the immutable
handoff between local build verification and a future authenticated upload or
release API.

The envelope contains no credentials, account identity, timestamps, mutable
release status, provider endpoint, runtime configuration, or executable bytes.
Those concerns belong to authenticated transport and control-plane layers.

## Envelope

A release has `kind: "hypequery-deployment-release"`, `version: 1`, the
domain-separated `bundleIdentity` of one RFC 0007 bundle manifest, and a closed
`target` object with `project` and `environment` tokens. Unknown fields fail
closed.

Project and environment tokens are case-sensitive opaque ASCII values. Each
begins with an ASCII letter or digit and may then contain ASCII letters, digits,
`.`, `_`, `:`, or `-`. They are identifiers within the receiving product; this
RFC does not assign project ownership or environment policy.

Before constructing a release, a producer MUST completely verify the referenced
bundle under RFC 0007 and use the resulting bundle identity. A consumer MUST
reverify uploaded bundle bytes and require the same identity before accepting
the release. A release identity is safe to use as an idempotency key for the
same target and bundle.

## Canonical bytes and identity

A release is validated before encoding. Its canonical bytes are the UTF-8
encoding of its RFC 8785 JSON serialization. The deployment release v1 identity
is lowercase hexadecimal SHA-256 over the UTF-8 bytes of
`hypequery:deployment-release:v1\0` followed by those canonical bytes. `\0`
denotes one zero byte.

Changing the project, environment, or bundle identity creates a different
release identity. Retries of an unchanged envelope preserve the same identity.
Timestamps and requester identity are excluded because they would make retries
non-deterministic; a receiving service records them as release state.

## Limits

| Limit | Maximum |
| --- | ---: |
| Project token UTF-8 bytes | 128 |
| Environment token UTF-8 bytes | 128 |

Products may lower but not raise these limits while claiming deployment release
version 1 conformance.

## Stable failure codes

- `HQ_RELEASE_TYPE`
- `HQ_RELEASE_UNKNOWN_FIELD`
- `HQ_RELEASE_INVALID_VERSION`
- `HQ_RELEASE_INVALID_VALUE`
- `HQ_RELEASE_TOO_LARGE`
- `HQ_RELEASE_UNSAFE_OBJECT`

## Security

Objects with custom prototypes, accessors, symbols, or hidden properties are
rejected. Target values are routing identifiers, not authorization evidence.
Possession of a valid release envelope does not grant project access, authorize
upload, sign the bundle, or permit execution. Authenticated transport MUST bind
the caller to the target project and MUST revalidate both release and bundle.
