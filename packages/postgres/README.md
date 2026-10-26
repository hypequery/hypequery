# @hypequery/postgres

Run [hypequery datasets](https://hypequery.com) on Postgres. Define datasets once, query them on Postgres today, and move to ClickHouse later without changing consumer code.

```ts
import pg from 'pg';
import { createDatasetClient } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '@hypequery/postgres';

const queryBuilder = createPostgresQueryBuilder({
  pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  statementTimeoutMs: 10_000, // default 30s; protects OLTP primaries
});

const client = createDatasetClient({ queryBuilder });
```

`pg` is not a dependency: pass any node-postgres `Pool`, or implement the one-method `PostgresDriver` interface over another client.

## What runs on Postgres

| Feature | Status |
|---|---|
| Aggregates: sum, count, countDistinct, avg, min, max | ✅ |
| percentile, argMax / argMin, stddev, variance | ✅ |
| approxCountDistinct | ✅ (exact count) |
| Measure filters, segments, caller filters, tenancy | ✅ |
| Time grains in a query timezone (Sunday weeks, as on ClickHouse) | ✅ |
| Derived measures, `having`, metrics | ✅ |
| Relationships (single-match `LEFT JOIN LATERAL … LIMIT 1`) | ✅ |
| Raw `sql` dimensions/measures | ✅ checked by a Postgres-aware lexer |
| Time measures: trailing, toDate, cumulative, shift, and formulas over them | ✅ |
| `final: true` datasets, `measure.merge` | ❌ ClickHouse-only |

Every case in the datasets golden corpus, plus DST, sub-second and guard edge cases, is executed on both ClickHouse and Postgres over the same rows and must return the same results (`src/tests/integration/cross-engine-parity.test.ts`).

## Safety

Every query runs in its own `READ ONLY` transaction, with `statement_timeout`, a UTC session time zone and `standard_conforming_strings` pinned. Statements use the extended protocol, which rejects more than one statement. Aborting a query's `AbortSignal` cancels it on the server.

Time measures validate their axis inside SQL (result limits, per-row fan-out, skipped local calendar days). Postgres has no expression that raises, so those checks fail as a cast error carrying the message; `createPgDriver` rethrows it as the plain message. A custom `PostgresDriver` should pass errors through `toGuardError` to do the same.

## Results

Results follow the hypequery value contract shared with ClickHouse. Measures are strings. 64-bit integers are never rounded. Time buckets render as `YYYY-MM-DD HH:MM:SS` (minute, hour, day) or `YYYY-MM-DD` (week and coarser).
