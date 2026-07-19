# Deployment control plane 0002: Target activation

- Status: Proposed
- Version: deployment activation 1

## Summary

This specification defines how an accepted deployment release becomes the
active release for one project and environment. Activation changes only
control-plane state. It does not alter the immutable release, bundle, deployment
contract, or runtime artifacts, and it does not prescribe runtime loading or
traffic routing.

## Preconditions

Before attempting an activation, an implementation MUST:

1. validate the target and release identity using the release-envelope v1
   constraints;
2. locate the accepted release by its recomputed release identity;
3. completely revalidate the accepted release and its closed bundle;
4. require the release target to equal the requested project and environment;
5. authorize the caller for that target at the provider boundary.

An activation MUST fail closed if the release is missing, its stored content is
unavailable or invalid, or its target differs. An active pointer does not replace
stored-content validation.

## Compare-and-swap request

An activation request contains:

- `target`: the exact `project` and `environment`;
- `releaseIdentity`: the accepted release to activate;
- `expectedRevision`: the currently observed activation revision, or `null` if
  the caller observed no active release.

The revision, rather than only the release identity, is the concurrency token.
Every successful transition creates a new revision, including a rollback to a
previously active release. This prevents an ABA sequence from satisfying a
stale caller's comparison.

If the requested release is already active, the operation is idempotent and
returns `already-active`, regardless of `expectedRevision`. Otherwise, if the
current revision does not equal `expectedRevision`, the operation returns
`conflict` with the current record and makes no change. A successful comparison
atomically commits one new record and returns `activated`.

## Activation record

Each committed record is immutable and contains:

- kind `hypequery-deployment-activation` and version `1`;
- a domain-separated SHA-256 revision of the complete transition payload;
- the exact target and new release identity;
- the previous activation revision and release identity, or `null` for the
  first activation;
- a receiver-generated canonical UTC timestamp.

The timestamp is operational metadata and is not a concurrency token or proof
of ordering. Chain position defines ordering. History readers MUST reject
non-canonical records, revision mismatches, invalid predecessor links, cycles,
branches, and unreachable records.

Rollback uses the same activation operation with an older accepted release
identity. There is no special rollback mutation and no historical record is
rewritten.

## Reference filesystem registry

The reference registry uses this layout beneath the deployment store root:

```text
activations/
  <target identity>/
    target.json
    claims/
      initial/activation.json
      <previous activation revision>/activation.json
```

The target identity is a domain-separated hash of the canonical target. The
stored `target.json` is checked on every read so a path collision or misplaced
directory fails closed.

Each claim directory is named for the revision it replaces. The first
activation claims `initial`; later activations claim the current revision.
Publishing a complete claim directory with an atomic rename is the commit point.
Only one writer can claim a predecessor, providing compare-and-swap across
processes without a mutable current file or a lock that can remain stale after a
crash.

Files and directories are synced before and after publication where the host
platform exposes those operations. A crash before rename may leave an ignored
staging directory. A crash after rename leaves a complete committed record that
history traversal discovers. Unknown, symbolic-link, partial, conflicting, or
unreachable committed state fails closed.

## Out of scope

This version does not define HTTP routes, authentication mechanisms, runtime
materialization, traffic switching, health checks, automatic rollback,
deactivation, retention, or garbage collection.
