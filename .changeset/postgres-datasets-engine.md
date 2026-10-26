---
"@hypequery/postgres": minor
---

New package: run hypequery datasets on Postgres. `createPostgresQueryBuilder({ pool })` plugs into `createDatasetClient({ queryBuilder })` and supports aggregates (including percentile, argMax/argMin, stddev and variance), measure filters, segments, caller filters, time grains in a query timezone, derived measures, `having` and relationship traversal. Results follow the same contract as ClickHouse: floating-point division, NULLs sorted last, Sunday weeks and RFC 0015 period text. Each query runs read-only with a statement timeout and is cancelled on abort. Time measures (trailing, toDate, cumulative, shift) are refused with a clear error for now.
