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
the result.

A target portable execution cannot reproduce fails closed with
`unsupported-capability` rather than being approximated — a derived metric,
whose symbolic expression contract v1 does not carry until `CORE-17`. A single
such metric no longer makes the rest of a deployment unexecutable:
`rehydrateProtocolDatasets` gains `onUnsupportedMetric: 'skip'`, and the
requested target is refused at the point of use instead.

The deployment data plane now honours a failure category an injected executor
claims for itself, from a fixed allow-list, so a capability gap is reported as
one rather than as a broken query. An executor that claims nothing — or claims a
category it may not, such as `forbidden` — still reports `executor-failed` with
the generic message.
