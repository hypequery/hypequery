---
"@hypequery/datasets": minor
"@hypequery/serve": minor
"@hypequery/react": minor
---

Type semantic query measure and metric values as `string` instead of `number`.

ClickHouse serializes aggregate results (`UInt64`, `Decimal`, ...) as strings
over JSON, and the query builder already types aggregation outputs as `string`.
The dataset/metric result row types (`DatasetRow`, `DatasetRowFor`, `MetricRow`,
`MetricRowFor`, and the `@hypequery/react` hook rows inferred through
`@hypequery/serve`) previously typed those same values as `number`, so a typed
row claimed `revenue: number` while the runtime handed back `"1234.56"`. The
types now match runtime.

**Breaking (types only):** code that assigned a measure or metric value
straight into a `number` — e.g. `const revenue: number = row.revenue` — will no
longer compile. Parse at the edge instead: `Number(row.revenue)` (or
`parseFloat`). Dimension values are unchanged; only aggregated measure/metric
columns are affected.
