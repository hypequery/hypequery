---
'@hypequery/datasets': minor
---

Query-scoped calculations (RFC 0026): `rank`, `share`, `limitBy` and `other` now execute instead of being refused.

- `rank`: SQL `rank()` over the grouped rows, partitioned by `within`, computed before `having` so a rank keeps its global position.
- `share`: exact percent of total at the `of` grain. Additive inputs (`sum`/`count`, and filters, shifts, windows and compare differences over them) use `sum() OVER (PARTITION BY ...)`. Non-additive inputs such as `countDistinct` or `avg` are re-aggregated from source rows at the coarser grain and joined back with NULL-safe keys. Non-additive inputs over shifts or windows are refused by name.
- `limitBy`: ClickHouse `LIMIT n BY`, after `having` and before paging.
- `other`: keeps the top-N values of one string dimension (ranked over the whole filtered query, NULL never a top value) and buckets the rest as a label. It does this in one statement that regroups source rows, so every measure in the remainder row is exact. Filters, segments and measures still read source values.
