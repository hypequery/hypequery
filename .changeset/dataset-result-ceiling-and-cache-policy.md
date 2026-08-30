---
"@hypequery/datasets": minor
---

Enforce `limits.maxResultSize` for queries that set no limit of their own. Query validation already rejected a limit *above* the ceiling, but both validators guard on `query.limit != null`, so an unbounded query skipped the ceiling entirely and streamed whatever the table held. A ceiling that only binds callers who happened to name a limit is not a ceiling. Bounding is reported in `meta.resultLimit`, never applied silently — a caller who asked for everything and received 1,000 rows could not otherwise tell a bounded answer from a complete one.

Add `cache` to `DatasetConfig`: a declared result-cache policy with `ttlMs` (the default when the caller and client supply none) and `maxTtlMs` (a ceiling on any caller- or client-supplied TTL, and on the stale-while-revalidate window layered on it). Whether a result is still-filling or already final is known by whoever defined the model, not by a caller three packages away. A call may still shorten the window or bypass the cache entirely; it can never extend one past `maxTtlMs`. The precedence rule mirrors `resolveCompiledDeadline` in `@hypequery/clickhouse`.
