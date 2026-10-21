---
'@hypequery/datasets': patch
---

Bind time-measure (window and shift) axis bounds as query parameters instead of writing them into the SQL text. `compileDataset()` and `toSQL()` now show `parseDateTime64BestEffort(?, …)` with the caller's bounds in `parameters` (and in each preflight statement's parameters). The statement ClickHouse executes is unchanged.
