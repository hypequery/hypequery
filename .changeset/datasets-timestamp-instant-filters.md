---
'@hypequery/datasets': patch
---

Accept ISO 8601 instants in timestamp filters. A value carrying `Z` or an offset, such as `new Date().toISOString()` produces (`2026-02-01T00:00:00Z`, `2026-02-01T00:00:00.000Z`), previously failed in ClickHouse with "Cannot convert string ... to type DateTime64". The datasets planner now rewrites such a value to its wall clock in the zone the column is compared in, so it selects the same rows as the equivalent offset-free form and matches the Python planner. Offset-free values (`2026-02-01T00:00:00`, `2026-02-01 00:00:00`, `2026-02-01`) are bound unchanged and still read as local time in the query timezone.
