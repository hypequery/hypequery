# Deployment runtime 0004: Active-release materialization

- Status: Proposed
- Version: deployment runtime materialization 1

## Summary

This specification defines the boundary between target activation and runtime
startup. Materialization resolves the currently active release, completely
revalidates its closed bundle, copies every referenced runtime artifact into an
immutable snapshot, and confirms that the activation did not change while the
copy was made.

Materialization does not import, execute, supervise, or route traffic to runtime
code.

## Inputs and trust boundaries

A materializer requires:

- an activation registry implementing specification 0002;
- a release reader that returns only accepted releases whose release envelope
  and closed bundle were completely revalidated;
- a target expressed using the release-target v1 constraints.

The release reader is a provider boundary. The materializer MUST independently
revalidate the returned bundle directory before copying runtime bytes. Release
identity, release target, release bundle identity, and recomputed bundle
identity MUST all agree with the activation.

## Snapshot construction

For each manifest-declared runtime artifact, materialization MUST:

1. open the declared path without following symbolic links;
2. require a regular file with the exact declared byte length;
3. read no more than the closed bundle limits;
4. recompute and compare SHA-256;
5. retain a private copy that cannot be mutated through the public snapshot.

Materialization fails with `HQ_RUNTIME_MATERIALIZATION_CONFIGURATION` when the
host cannot open files with a no-follow primitive. An `lstat`-then-open sequence
alone is insufficient because a path can be replaced between those operations.

The resulting snapshot contains:

- the exact activation record and target;
- the release and release identity;
- the bundle identity and validated deployment contract;
- runtime, digest, byte length, and entrypoints for each artifact;
- the deterministic mapping from named queries to runtime references.

Artifact reads from the snapshot MUST return independent copies. Changing a
returned byte array or the durable bundle after materialization cannot alter
the snapshot.

## Activation stability

The materializer reads the current activation before constructing the snapshot
and reads it again afterward. The snapshot may be returned only when both reads
have the same activation revision. If the revision changed, the intermediate
snapshot is discarded and materialization retries from the new activation.
If either read finds no activation, the intermediate snapshot is discarded and
no snapshot is returned.

Retries are bounded. Repeated activation churn fails with a stable
`HQ_RUNTIME_MATERIALIZATION_UNSTABLE_ACTIVATION` error rather than returning a
snapshot that was never confirmed current. A target with no activation returns
no snapshot and is not an error.

## Fail-closed behavior

Missing releases, invalid release-to-target bindings, bundle identity
mismatches, revalidation failures, symbolic links, changed artifact lengths,
and digest mismatches fail closed. No partially materialized snapshot is
returned.

## Out of scope

This version does not define module loading, worker or process isolation,
readiness checks, request execution, traffic switching, draining, automatic
rollback, retention, or garbage collection.
