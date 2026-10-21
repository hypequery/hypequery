---
'@hypequery/datasets': patch
---

Refuse timestamp filter values that are not a real ISO 8601 date or date-time, such as `2026-13-45`, `2026-02-30`, `yesterday`, `20260201` or `2026-01-31 12:00`. `validate()` reports them and execution fails before planning. ClickHouse read some of these as a different instant instead of failing: `2026-13-45` became 1900-01-01 and `2026-02-30` rolled into March, so queries silently returned wrong totals. Accepted forms are `YYYY-MM-DD`, or `YYYY-MM-DD[T ]hh:mm:ss[.fraction]` optionally followed by `Z` or `±hh:mm`, which includes `Date#toISOString()` output. `like` patterns on timestamp fields are unchanged.
