---
'@hypequery/datasets': minor
'@hypequery/clickhouse': minor
---

Add `approxCountDistinct` (RFC 0015, HQ-77):
- `measure.approxCountDistinct(field)` and the `approxCountDistinct` aggregation helper estimate distinct counts with ClickHouse `uniq`, including with measure filters.
- The ClickHouse query builder gains `.approxCountDistinct(column, alias?)`.
- Catalogs, the semantic contract, and the agent-safe catalog mark approximate measures, and derived measures that use them, with `approximate: true`.
- The in-memory backend computes the count exactly.
- Publishing to Cloud refuses approximate measures with an actionable error until deployment contract 3 is emitted.
