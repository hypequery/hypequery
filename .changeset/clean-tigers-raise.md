---
'@hypequery/clickhouse': patch
---

Fix two ClickHouse query/type-safety issues.

- Fix builder-level per-query settings so `.settings(...)` is forwarded at execution time via ClickHouse `clickhouse_settings` instead of being silently ignored. This also forwards `queryId` as ClickHouse `query_id`, merges repeated `.settings(...)` calls, and adds matching `rawQuery(..., options?)` support for per-query execution options.
- Fix type inference for wide ClickHouse integers so `Int64`/`UInt64` and wider widths map to `string` instead of `number` in both core inference and generated record types. This also preserves `rawAs()` aliases in mixed `select([...])` calls so aliased raw expressions appear in `execute()` result types with `unknown` by default or the explicit generic type when provided.
