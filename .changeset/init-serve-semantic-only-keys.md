---
"@hypequery/serve": patch
---

`initServe(...).serve()` / `.define()` called with only `datasets` and/or `metrics` (no `queries`) no longer widens `InferApiType` to a string index signature. The inferred API now keeps its `dataset:<name>` and metric keys, so `createAnalyticsHooks<Api>()`'s `useDataset('orders', …)` and `useMetric(…)` type-check with inferred rows instead of typing the name as `never`.
