---
"@hypequery/datasets": minor
"@hypequery/serve": minor
"@hypequery/react": minor
"@hypequery/cli": minor
---

Tighten semantic API type inference, add projection-aware dataset and metric result
types, preserve projected rows through React analytics hooks, and add static manifest
generation for Next.js clients.

BREAKING (types only, no runtime change): dataset and metric result rows are now
projection-typed. `DatasetQueryResultFor` / `MetricResultFor` rows — including the
`output` types produced by `InferApiType` / `InferAPIType` and the result of
`createDatasetClient().execute()` — no longer expose dimension keys or `period`
unless the query selects them via `dimensions` / `by`. Code that read dimension
fields off default (non-projected) result types must now pass the projection in
the query it executes.
