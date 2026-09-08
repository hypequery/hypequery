---
"@hypequery/datasets": minor
"@hypequery/deployment": minor
---

Add portable native execution of a semantic invocation (decision 0005).

`createPortableSemanticExecutor()` in `@hypequery/datasets` resolves a dataset
or metric from the validated active contract, rebuilds its catalog, and plans
the query with the existing semantic planner. No customer module is loaded and
no isolated runtime is required, so a bundle answers dataset and metric calls
without a separately loaded MCP config. It applies the resolved tenant,
propagates deadlines and cancellation to the database request, and byte-limits
the result. A request the deadline aborts is reported as the budget it overran
rather than as the driver's generic failure, so a caller can tell a query that
ran out of time — worth retrying with less — from a broken or unreachable one.

A resolved tenant that the rebuilt dataset has no field to scope by is refused
before a query is built. That is the one failure that is otherwise silent: the
runtime accepts the tenant, the planner emits no predicate, and the query reads
every tenant while each layer believes tenancy was enforced. Contract validation
already refuses to publish that shape, but the executor is exported on its own
and typed structurally, so it cannot assume a caller went through the validator.

A target portable execution cannot reproduce fails closed with
`unsupported-capability` rather than being approximated — a derived metric,
whose symbolic expression contract v1 does not carry until `CORE-17`. A single
such metric no longer makes the rest of a deployment unexecutable:
`rehydrateProtocolDatasets` gains `onUnsupportedMetric: 'skip'`, and the
requested target is refused at the point of use instead.

The deployment data plane now honours a failure category an injected executor
claims for itself, from a fixed allow-list, so a capability gap is reported as
one rather than as a broken query. A claim is granted by an explicit marker on
the error rather than by its shape: a provider or library exception that happens
to carry a generic `category` — a `not-found` from an HTTP client, say — cannot
put its own message in front of a caller or decide whether the call is retried.
An executor that claims nothing, that claims a category it may not (such as
`forbidden`), or that never opted in, still reports `executor-failed` with the
generic message. `PortableExecutionTenantError` joins the exported unsupported
and budget errors that carry the marker.
