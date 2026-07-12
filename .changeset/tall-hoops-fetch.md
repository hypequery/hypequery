---
"@hypequery/clickhouse": minor
---

Add type-safe insert API: `db.insert(table).values(rows).execute()`.

Row shapes are derived from the schema — `Nullable(...)` columns are optional, every other column is required, and value types are checked at compile time (DateTime columns accept `string | Date | number`, Date columns take `'YYYY-MM-DD'` strings, 64-bit integers accept `string | number | bigint`). Use `.columns([...])` to insert a subset of columns and let ClickHouse fill table DEFAULTs, and `.settings({...})` for per-insert ClickHouse settings. Empty batches are a no-op (`{ executed: false }`), and non-finite numbers are rejected before the request is sent. Inserts run through the native client insert path (JSONEachRow); `DatabaseAdapter` gains an optional `insert` method, so existing custom adapters keep working unchanged. Adapter authors can implement insert support in a few lines with the new `buildJsonEachRowInsert` helper, which renders the complete `INSERT ... FORMAT JSONEachRow` statement with identical row normalization and settings.

**Behavior change for reads:** the built-in ClickHouse adapter now sets `output_format_json_quote_64bit_integers: 1` by default, so `Int64`/`UInt64` (and larger) values are returned as strings instead of lossy numbers — matching what the generated schema types already declare. If you were relying on numeric 64-bit values at runtime, either convert with `Number(...)`/`BigInt(...)` or pass `output_format_json_quote_64bit_integers: 0` via query settings to restore the old behavior.
