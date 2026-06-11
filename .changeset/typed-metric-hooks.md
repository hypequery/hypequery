---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Carry a metric's dataset type through `MetricRef` for field-level metric hooks.

`MetricRef` / `GrainedMetricRef` / `MetricHandle` (and `BaseMetricRef` /
`DerivedMetricRef`) gain an optional `TDataset` type parameter that defaults to
the previous wide instance, so existing usages are unchanged. `DatasetInstance.metric()`
now returns a ref carrying its dataset's concrete dimension/measure types.

`@hypequery/serve`'s `SemanticMetricEndpointMap` uses this to specialize each
metric endpoint, so via `@hypequery/react` `useMetric(name, input)` gets
autocomplete and type-checking for `dimensions`/`orderBy`, and result rows are
typed by the dataset's dimensions plus the metric's value column. This completes
the typed-hooks work started for datasets; metric endpoints degrade gracefully to
loose `string` fields when a ref has been widened.
