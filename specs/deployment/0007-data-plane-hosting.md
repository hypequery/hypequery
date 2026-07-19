# Deployment runtime 0007: Data-plane hosting

- Status: Proposed
- Version: deployment host 1

## Summary

This specification defines provider-neutral hosting for deployment data planes.
It binds one immutable deployment contract, one supervised runtime generation,
and one set of query routes to the same activation revision. It also defines
bounded Fetch and Node HTTP adaptation and a reference single-host filesystem
composition.

## Generation-pinned installation

A host reconciles a deployment target through its runtime supervisor. When a
runtime is active, the supervisor returns an atomic generation view containing
both runtime status and the immutable deployment contract materialized for that
activation revision.

The host constructs query policy, schemas, and routes from that exact contract.
Runtime-reference dispatch includes the exact activation revision. Before
publishing the data plane, the host confirms that the supervisor still exposes
the same revision. If activation changes during asynchronous configuration, the
host discards the candidate and retries within a fixed bound.

New requests use only the published generation. Existing requests may drain on
the previous runtime according to runtime-supervision rules. A stale data plane
cannot invoke a newer runtime generation because revision-pinned invocation
fails closed.

## Reconciliation lifecycle

Configured targets are reconciled during startup. A target with no active
release has no published data plane. Durable activation schedules serialized
reconciliation for that target.

Activation persistence and runtime readiness are distinct outcomes. A runtime
startup or host-configuration failure after durable activation is reported to
provider diagnostics, but cannot change the successful activation response.
Operators can retry reconciliation or activate a previous release through the
normal compare-and-swap operation.

Shutdown rejects new host work, waits for target reconciliation and background
work to settle, removes published data planes, and closes the runtime
supervisor. Concurrent shutdown callers await the same operation.

## HTTP adaptation

Fetch and Node adapters pass an exact uppercase method, URL pathname, duplicate-
preserving query record, normalized header record, credentials, and cancellation
signal to the data plane.

A request supplies input through either query parameters or one JSON body, not
both. Bodies require `application/json` with optional UTF-8 charset, are read
within a configurable protocol maximum, and are parsed with duplicate-property
awareness. Declared and observed body lengths must agree. Query names with
multiple values become arrays.

Successful non-void output is encoded as UTF-8 JSON. Void output uses status
204. Public cache headers are emitted only from data-plane results that confirm
public, tenant-independent, unauthenticated execution; every other response is
`no-store`. Internal exception details are never placed in public responses.

## Reference filesystem composition

The reference single-host assembly composes:

- the durable filesystem submission store and activation registry;
- authenticated intake and control-plane handling;
- runtime materialization and supervision;
- generation-pinned data-plane hosting; and
- activation-triggered reconciliation and graceful shutdown.

The assembly defaults to the trusted Node worker runtime factory. Providers may
inject another runtime factory and all data-plane authentication, tenant,
semantic-plan, compiled-SQL, and runtime argument adapters.

## Out of scope

Version 1 does not define listeners, TLS, distributed activation propagation,
leader election, shared storage, database clients, credential stores, rate
limiting, tracing export, autoscaling, release retention, or hostile-code
sandboxing. Cloud systems own those concerns while consuming these interfaces
and immutable artifacts.
