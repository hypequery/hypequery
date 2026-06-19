---
"@hypequery/datasets": patch
---

Fix three semantic-layer deviations surfaced by manual testing.

- **SQL-backed measures now carry through metrics.** A metric built from a
  measure with a `sql` override (e.g. `measure.sum('amount', { sql: 'amount * 1.2' })`)
  previously dropped the override on the query-builder path, emitting a plain
  `SUM(amount)`. The override is now threaded through `AggregationSpec`, so the
  metric compiles to `SUM(amount * 1.2)` like the dataset path already did. The
  semantic (non-SQL) backend rejects such metrics with a clear error instead of
  silently ignoring the expression.
- **Unsupported time grains are rejected.** `by: 'hour'` (or any grain outside
  `day | week | month | quarter | year`) now fails validation with
  `Unsupported time grain "hour"` instead of emitting `undefined(created_at)`.
  The planner also throws defensively if it ever receives an unknown grain.
- **`quoteSQLIdentifier` uses ClickHouse backtick quoting** (`` `col` ``) rather
  than ANSI double quotes, escaping embedded backticks by doubling them.
