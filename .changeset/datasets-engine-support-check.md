---
"@hypequery/datasets": minor
"@hypequery/serve": patch
---

Refuse datasets an engine cannot run when an API is set up, not on the first query that reaches them. `datasetQueryBuilderErrors(dataset, queryBuilder)` lists the problems, and `assertDatasetsSupported(datasets, queryBuilder)` throws on any. The checks cover:

- raw `sql` that is unsafe under the engine's lexer
- `final: true` without a row-version modifier, including on relationship targets
- aggregations the builder does not implement, such as `merge` or `percentile`
- relationships without a single-match join

`createAPI` runs the check over its datasets.
