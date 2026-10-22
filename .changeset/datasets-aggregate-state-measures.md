---
'@hypequery/datasets': minor
'@hypequery/clickhouse': minor
---

Add `measure.merge(stateFunction, field)` (and `merge()` for metric configs) to read `AggregateFunction` columns of AggregatingMergeTree tables with the matching `-Merge` combinator, for example `measure.merge('uniq', 'users')` renders `uniqMerge(users)`. Trailing and to-date windows merge states across buckets, so weekly distinct counts from daily states are exact to the state function. State functions are allowlisted; merges of estimating states are catalogued as `approximate`. Merge measures are refused with measure filters, raw `sql`, relationships, cumulative windows, semantic backends and deployment-contract publishing. `@hypequery/clickhouse` adds `mergeState(stateFunction, column, alias)` to the query builder; `QueryBuilderLike` gains it as an optional member.
