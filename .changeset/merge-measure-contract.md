---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
---

Publish `measure.merge` measures to the deployment contract (RFC 0022). A base
measure may use `aggregation: 'merge'` with a `stateFunction` from the shared
allowlist (now exported by `@hypequery/protocol`); it takes no filters or `sql`,
and in contract 3 carries `approximate: true` exactly for estimating states.
Deployments rehydrate merge measures, so hosted runtimes can serve
pre-aggregated tables. A metric over a merge measure is still refused, because
the expression grammar has no merge aggregate.
