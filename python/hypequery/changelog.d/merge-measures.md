- `measure.merge(state_function, field)` reads an `AggregateFunction` column of
  an AggregatingMergeTree table (or the materialized view feeding one) by
  merging its states: `measure.merge("uniq", "users")` is `uniqMerge(users)`,
  so a week of daily states merges into one distinct count instead of summing
  daily counts (RFC 0022). The state function must be one of RFC 0022's list;
  merge measures take no filters or `sql` and are not merged through a
  relationship. Estimating states (`uniq`, `uniqCombined`, ...) are marked
  `approximate`, and the deployment contract carries `stateFunction`, matching
  TypeScript (shared fixture `specs/datasets/merge-authoring-v1.json`).
