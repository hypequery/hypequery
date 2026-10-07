---
"@hypequery/datasets": minor
---

`week` buckets now start on Monday (ISO 8601). The datasets planner emitted
ClickHouse `toStartOfWeek(…)`, whose default mode starts weeks on Sunday. That
disagreed with the in-memory backend and the query builder's own
`toStartOfWeek()` helper, which both use Monday. It now emits `toMonday(…)`,
which still applies the query timezone and still returns a `Date`.

Weekly results change: a week period is now the Monday that starts it, and
rows from a Sunday move into the week that began six days earlier. If you
depend on Sunday weeks, pin a previous version and tell us at
https://github.com/hypequery/hypequery/issues so we can prioritise a
configurable week start.
