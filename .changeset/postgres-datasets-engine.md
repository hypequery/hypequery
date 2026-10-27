---
"@hypequery/postgres": minor
---

New package: run hypequery datasets on Postgres. Pass `createPostgresQueryBuilder({ pool })` to `createDatasetClient({ queryBuilder })`. The full datasets surface is supported:

- aggregates, including percentile, argMax/argMin, stddev and variance
- measure filters, segments, caller filters and time grains in a query timezone
- derived measures, `having` and relationship traversal
- time measures (trailing, toDate, cumulative, shift) and formulas over them

Results match ClickHouse, checked by a cross-engine parity suite over identical data. Division is floating point, `round` rounds half to even, NULLs sort last, weeks start on Sunday, and buckets stay distinct across DST transitions. Each query runs read-only with a statement timeout, through a server-side cursor that admits only a single query and refuses results over `maxRows` (default 100,000), and is cancelled on abort.
