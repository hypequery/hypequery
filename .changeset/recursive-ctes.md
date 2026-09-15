---
"@hypequery/clickhouse": minor
---

Add recursive CTEs, typed CTE sources, and raw CTE parameters.

- Use `withRecursiveCTE()` to write recursive queries. Ordinary CTEs and scalar aliases can share the `WITH RECURSIVE` clause.
- Use `db.withCTE(...).table(alias)` or `db.withRecursiveCTE(...).table(alias)` to read from a CTE with typed columns. `FINAL` and `PREWHERE` are rejected on CTE sources.
- Pass `{ sql, parameters }` to either method to bind `{name:Type}` placeholders. Values retain their declared types, including UUIDs, arrays, tuples, maps, and JSON objects. Values are escaped client-side at rendering or execution time.

Existing `withCTE()` calls remain supported.
