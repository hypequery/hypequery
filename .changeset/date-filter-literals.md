---
"@hypequery/clickhouse": minor
---

Fix JavaScript `Date` filter values against `DateTime` sorting-key columns. A `Date` used to render as a quoted ISO string (`'2026-03-01T00:00:00.000Z'`), which ClickHouse rejects with `TYPE_MISMATCH` when it compares the string with a `DateTime` column in the sorting key. The same happened for a `Date` column, and for any value with milliseconds. A `Date` now renders as `toDateTime('2026-03-01 00:00:00', 'UTC')`, or as `toDateTime64(..., 3, 'UTC')` when it has milliseconds or falls outside the `DateTime` range. This keeps the exact UTC instant, still lets the primary index prune, and works in `IN` lists. It applies to `where`, `between`, `in`, `rawQuery` placeholders and `CrossFilter`. `CrossFilter` no longer converts `Date` values to ISO strings itself. Dates inside array, tuple and map parameters are still sent as ISO text, which `CAST` parses correctly.
