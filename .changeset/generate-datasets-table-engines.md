---
"@hypequery/cli": minor
---

`generate:datasets` and `init --style datasets` now read each table's engine from `system.tables`, so scaffolded datasets no longer count rows ClickHouse hasn't merged yet. ReplacingMergeTree tables get `rowResolution: { kind: 'final', engine: 'replacing' }` (with `deletedColumn` when the engine has one), and CollapsingMergeTree / VersionedCollapsingMergeTree tables get the matching `signColumn` resolution. Version, sign and deleted columns are no longer summed or averaged. Pre-aggregated tables drop the row-count measure: `AggregateFunction` columns become `measure.merge(...)` measures (parametric states such as `quantile(0.9)` are noted and skipped), `SimpleAggregateFunction(sum|min|max, …)` columns use that function, and SummingMergeTree tables sum only their summing columns. If the engines can't be read, tables are scaffolded as before.
