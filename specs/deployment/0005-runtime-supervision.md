# Deployment runtime 0005: Supervision and traffic switching

- Status: Proposed
- Version: deployment runtime supervision 1

## Summary

This specification defines how materialized snapshots become ready runtime
generations and how named-query invocations switch between generations without
sending new work to a draining runtime.

The supervisor is runtime-neutral. A reference Node factory imports materialized
Node artifacts in worker threads; providers may supply other factories,
including Python processes or remote sandboxes, while retaining the same
lifecycle contract.

## Runtime factory

A runtime factory receives one immutable snapshot from specification 0004 and
starts an isolated runtime instance. An instance implements:

- `healthCheck`, which resolves only when the candidate can accept work;
- `invoke`, which executes one materialized named-query binding with an opaque
  structured-clone-compatible argument;
- `close`, which rejects new work and releases runtime resources.

Factory startup failure MUST clean up resources it created. A failed candidate
is never installed as active.

## Reconciliation and readiness

Reconciliation for one target is serialized. It performs these steps:

1. materialize the confirmed current activation;
2. return `already-current` when that revision is already serving;
3. start a candidate while the previous generation remains active;
4. require the candidate readiness check to succeed;
5. materialize current state again and require the same revision;
6. atomically replace the active generation;
7. begin draining the previous generation.

If activation changes during candidate startup, the candidate is closed and
reconciliation retries with the new activation. Retries are bounded. Startup,
readiness, or stability failure leaves the previous active generation
unchanged.

A target with no activation removes its active generation and starts draining
it. No-active state is not a runtime startup error.

## Invocation and cutover

Invocation selects the active generation synchronously before incrementing its
in-flight count. The named query MUST exist in the snapshot and use a
`runtime-reference` implementation. Portable semantic plans and compiled SQL
remain the responsibility of their native execution adapters.

The active-generation replacement is one synchronous state transition. Calls
selected before the transition complete on the old generation; calls selected
after it use the new generation. No new invocation may enter a generation once
draining starts.

## Draining and shutdown

A draining generation closes when its in-flight count reaches zero or when the
configured drain deadline expires. Deadline expiry permits forced isolation
shutdown so an unresponsive invocation cannot retain the generation forever.

Supervisor shutdown prevents new reconciliation and invocation, waits for
in-progress reconciliation to stop safely, drains all active generations, and
reports explicit close failures after attempting every close. Shutdown is
idempotent.

## Reference Node worker factory

The Node factory:

- recomputes every materialized artifact digest before writing executable
  temporary files;
- accepts only Node artifacts and rejects mixed or Python snapshots;
- imports modules in a dedicated worker thread;
- resolves every qualified entrypoint before reporting startup success;
- optionally resolves a snapshot-specific string environment before import;
- exchanges invocation values through structured clone;
- supports abortable startup and pre-dispatch calls;
- terminates the worker and removes temporary files on close.

When a provider configures snapshot-specific environment resolution, the
returned environment replaces inherited host process state for that worker.
The factory MUST copy and validate the resolved string record before worker
startup, MUST NOT mutate the parent `process.env`, and MUST fail candidate
startup if resolution or validation fails. Omitting the resolver retains
Node's default environment inheritance for backwards compatibility.

Worker readiness proves import and entrypoint resolution plus message-loop
responsiveness. It does not define application-specific dependency health.
Providers may wrap or replace the factory with stronger health checks.

Worker threads provide lifecycle and failure isolation, not a security sandbox.
Deployment code can use the Node APIs bundled or available to it and must be
treated as trusted code. Hostile-code isolation requires a provider factory
backed by an appropriately restricted process, container, or remote sandbox.

Once a Node worker invocation is dispatched, it remains in-flight until the
handler settles or the worker is terminated. An abort signal cannot safely
cancel one arbitrary JavaScript handler without affecting concurrent work; this
preserves accurate draining rather than reporting work complete while it still
runs.

## Out of scope

This version does not define HTTP request mapping, protocol-schema input/output
validation, authentication, tenant injection, portable SQL execution,
distributed coordination, automatic activation rollback, autoscaling, or
cross-host traffic routing.
