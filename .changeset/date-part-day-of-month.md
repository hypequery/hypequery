---
"@hypequery/clickhouse": patch
---

Fix `datePart('day', field)`: it now emits `toDayOfMonth(field)` instead of `toDay(field)`, which ClickHouse doesn't have (`UNKNOWN_FUNCTION`). The other units are unchanged.
