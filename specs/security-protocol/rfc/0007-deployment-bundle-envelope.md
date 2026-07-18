# RFC 0007: Deployment bundle envelope

- Status: Proposed
- Version: deployment bundle manifest 1

## Summary

This RFC defines the closed, content-addressed directory that transports an
RFC 0006 deployment contract and every runtime artifact it references. The
manifest binds the semantic deployment identity to exact file bytes so a build,
review, upload, and execution boundary can verify the same immutable input.

The bundle contains no credentials, target environment, release state,
signature, or runtime configuration. Upload and execution are separate layers.

## Manifest

A manifest has `kind: "hypequery-deployment-bundle"`, `version: 1`, one
`deployment` file, and a closed `artifacts` array. Unknown fields fail closed.

The deployment file records:

- a portable relative `path`;
- the domain-separated RFC 0006 deployment `identity`;
- the raw SHA-256 of the exact file bytes as lowercase hexadecimal; and
- the exact positive `byteLength`.

Each runtime artifact records its `runtime`, portable relative `path`, raw
SHA-256, and exact positive byte length. Artifact entries MUST be sorted by
path. Paths and artifact digests are unique, and the deployment path cannot be
reused by an artifact.

## Portable paths

Paths use `/` separators and are relative to the bundle root. Every segment
begins with an ASCII letter or digit and contains only ASCII letters, digits,
`.`, `_`, or `-`. Empty segments, absolute paths, backslashes, `.` and `..`
segments, URI forms, control characters, and percent-decoded alternatives are
invalid. Windows reserved device names, trailing-dot segments, and paths that
collide under ASCII case folding are also invalid. A consumer MUST NOT resolve
a manifest path outside the bundle root.

Filesystem implementations MUST reject symbolic links and non-regular files.
They MUST also reject files not declared by the manifest. These checks apply to
the manifest, deployment contract, artifact directory, and every intermediate
path component.

## Verification

A consumer accepts a bundle only after all of these checks succeed:

1. Parse and validate the complete manifest.
2. Enumerate the bundle without following symbolic links and reject undeclared
   or missing files.
3. Read each declared file within its byte budget and verify exact byte length
   and raw SHA-256.
4. Parse and validate the deployment contract, then recompute its RFC 0006
   identity and compare it to `deployment.identity`.
5. Require a one-to-one match between named-query runtime references,
   deployment runtime artifacts, and manifest artifact entries by runtime and
   SHA-256. An artifact may serve multiple queries, but no artifact may be
   unreferenced.

Verification is all-or-nothing. A consumer MUST NOT execute, cache, or upload a
partially verified bundle. The raw deployment-file hash intentionally includes
presentation bytes such as a trailing newline; the deployment identity remains
the domain-separated hash of validated RFC 8785 canonical bytes.

## Canonical bytes and identity

A manifest is validated before encoding. Its canonical bytes are the UTF-8
encoding of its RFC 8785 JSON serialization. The bundle manifest v1 identity is
lowercase hexadecimal SHA-256 over the UTF-8 bytes of
`hypequery:deployment-bundle:v1\0` followed by those canonical bytes. `\0`
denotes one zero byte.

The manifest identity identifies the set of declared files and their exact
bytes. It does not replace artifact hashes, the RFC 0006 deployment identity,
the RFC 0008 release identity, or a future detached signature.

## Limits

| Limit | Maximum |
| --- | ---: |
| Runtime artifacts | 100 |
| Portable path UTF-8 bytes | 1,024 |
| Deployment file bytes | 16 MiB |
| Individual runtime artifact bytes | 128 MiB |
| Sum of declared deployment and runtime artifact bytes | 256 MiB |

Products may lower but not raise these limits while claiming bundle manifest
version 1 conformance.

## Stable failure codes

- `HQ_BUNDLE_TYPE`
- `HQ_BUNDLE_UNKNOWN_FIELD`
- `HQ_BUNDLE_INVALID_VERSION`
- `HQ_BUNDLE_INVALID_VALUE`
- `HQ_BUNDLE_INVALID_PATH`
- `HQ_BUNDLE_INVALID_REFERENCE`
- `HQ_BUNDLE_TOO_MANY_ITEMS`
- `HQ_BUNDLE_TOO_LARGE`
- `HQ_BUNDLE_UNSAFE_OBJECT`

Filesystem verification errors are product errors and include the bundle path
and failed verification step. They do not extend the language-neutral manifest
validator's stable code set.

## Security

The manifest validator rejects custom prototypes, accessors, symbols, hidden
properties, sparse arrays, extra array properties, duplicate references, and
ambiguous paths. Filesystem consumers additionally reject symlinks, devices,
sockets, directories in file positions, undeclared files, hash mismatches, and
length mismatches. Writers stage a complete bundle in a new sibling directory
before publishing it by rename, so a failed build cannot leave a validly named
partial bundle. A writer may replace an output only after the existing path
passes complete bundle verification; unrelated or partially valid paths are
never removed.
