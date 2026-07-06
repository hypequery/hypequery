---
"@hypequery/clickhouse": minor
---

Add type-safe insert API: `db.insert(table).values(rows).execute()`.

Row shapes are derived from the schema — `Nullable(...)` columns are optional, every other column is required, and value types are checked at compile time (Date/DateTime columns accept `string | Date`, 64-bit integers accept `string | number | bigint`). Use `.columns([...])` to insert a subset of columns and let ClickHouse fill table DEFAULTs, and `.settings({...})` for per-insert ClickHouse settings. Inserts run through the native client insert path (JSONEachRow); `DatabaseAdapter` gains an optional `insert` method, so existing custom adapters keep working unchanged.
