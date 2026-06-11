---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Thread dataset field types through the generated API type for typed React hooks.

`@hypequery/datasets` now exports typed query/result helpers
(`DatasetQueryFor`, `DatasetRow`, `DatasetQueryResultFor`, and the
`DatasetDimensionNames`/`DatasetMeasureNames`/`DatasetOrderableNames` name
helpers, plus the metric equivalents).

`@hypequery/serve`'s `SemanticDatasetEndpointMap` now specializes each dataset
endpoint to its concrete instance, so `InferAPIType` carries field-level types.
With `@hypequery/react`, `useDataset(name, input)` gets autocomplete and
type-checking for `dimensions`/`measures`/`orderBy`, and result rows are typed
by the dataset's dimensions and measures.

Metric endpoints remain on the loose `MetricQuery`/`MetricResult` types for now:
`MetricRef` does not preserve its dataset's concrete dimension keys, so
field-level metric typing requires threading the dataset generics through
`MetricRef` — tracked as a follow-up.
