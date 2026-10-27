# RFC 0022: Merge measures over stored aggregate states

- Status: Proposed
- Version: merge measures 1

A dataset base measure may read an `AggregateFunction(<fn>, <type>)` column, as
stored by `AggregatingMergeTree` tables and the materialized views that feed
them, by merging its partial states:

```json
{ "name": "active_users", "aggregation": "merge", "stateFunction": "uniq", "field": "users", "filters": [] }
```

`stateFunction` is required exactly when `aggregation` is `merge`, and must be
one of `uniq`, `uniqExact`, `uniqCombined`, `uniqCombined64`, `uniqHLL12`,
`uniqTheta`, `count`, `sum`, `avg`, `min`, `max`, `any`, `anyLast` and
`groupBitmap`. Only non-parametric functions are listed: a parametric state
such as `quantile(0.9)` must be merged with its parameters, which a measure
cannot read back from the column type. The name is interpolated into SQL as
`<stateFunction>Merge(field)`, so implementations take it from this list and
never from anywhere else.

A merge measure takes no `filters` (a filtered merge needs `-MergeIf`, which is
not specified) and no `sql`. `argField` and `level` keep their existing rules.
Contract 2 carries no `approximate` marker; consumers derive it from the state
function. Contract 3 requires `approximate: true` exactly when the state
function estimates (`uniq`, `uniqCombined`, `uniqCombined64`, `uniqHLL12`,
`uniqTheta`), as for `approxCountDistinct`. A merge measure alone is not a
contract 3 feature. In contract 3, trailing and to-date windows may wrap a merge
measure, merging the states across the window, and inherit its `approximate`
marker; a `cumulative` window may not, because a merge is not among the
cumulative aggregations. The expression grammar has no merge aggregate, so a
metric over a merge measure is refused when publishing.

The field participates in deployment identity. Older implementations reject
the unknown aggregation and field; consumers must upgrade together rather than
strip it. Portable fixtures live in `fixtures/deployments-v2/` and
`fixtures/deployments-v3/`, shared by the TypeScript and Python validators.

The datasets planner renders `<stateFunction>Merge(field)` across the grouped
rows, so a seven-day query merges seven daily states into one result rather
than summing daily counts.
