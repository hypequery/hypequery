---
'@hypequery/datasets': minor
'@hypequery/mcp': patch
'@hypequery/clickhouse': patch
---

Add `minute` and `hour` time grains (RFC 0015, HQ-77). They bucket with `toStartOfMinute`/`toStartOfHour` and appear in catalogs, semantic query schemas, and the local MCP tools.

A new `timeGrains` dataset option restricts the grains a dataset supports, for example to refuse sub-day buckets on a `Date` time key. Queries, `.by()`, and the catalog honor it.

Publishing to Cloud still emits deployment contract 2:
- it refuses a sub-day `defaults.timeGrain` or pinned metric grain with an actionable error;
- published metric grain lists and rehydrated datasets stay at `day` through `year`.
