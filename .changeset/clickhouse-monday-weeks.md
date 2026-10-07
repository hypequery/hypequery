---
"@hypequery/clickhouse": minor
---

The deprecated semantic backend (`createBackend`) now starts `week` buckets on
Monday (ISO 8601), matching `@hypequery/datasets`, the in-memory backend and the
query builder's `toStartOfWeek()` helper. It emitted ClickHouse
`toStartOfWeek(…)`, whose default mode starts weeks on Sunday.

Weekly results from `createBackend` change: a week period is now the Monday that
starts it, and rows from a Sunday move into the week that began six days
earlier. Clear cached weekly results after upgrading. Query-builder SQL is
unchanged.
