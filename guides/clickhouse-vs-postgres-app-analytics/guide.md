# ClickHouse vs Postgres for app analytics: when Postgres is enough, and how to add ClickHouse

Measured on the same million events: which analytics queries Postgres handles, which need ClickHouse, and how to move data with CDC, dual writes or batch pulls.

The short answer: keep Postgres as the system of record, and keep serving analytics from it while the queries are lookups and small ranges an index can answer. Add ClickHouse when the product needs aggregations over most of a large table (time series over months, distinct users, percentiles, top N per group) at interactive speed, or when the events table is growing much faster than everything else. You do not replace Postgres; you copy the analytical tables into ClickHouse, usually with CDC, and point dashboards and APIs at it.

The numbers below come from loading the hypequery seed dataset (200 tenants, 1,000,000 events over twelve months) into both databases on the same laptop. The ClickHouse queries run in CI on every change; the Postgres side is reproducible with the commands at the end.

## The same queries on both

PostgreSQL 17.10 (`postgres:17-alpine`, default settings: `shared_buffers` 128 MB, `work_mem` 4 MB, two parallel workers) and ClickHouse 25.8 (`clickhouse/clickhouse-server:25.8`, default settings), both in Docker on one 8-CPU, 8 GB Docker VM. Postgres has a primary key on `event_id` and an index on `(tenant_id, occurred_at)`; ClickHouse uses the seed's `ORDER BY (tenant_id, occurred_at, event_id)`. Each figure is the server-side execution time, median of 7 warm runs; ranges are the spread over three rounds. Results were identical on both sides.

| Query | Postgres 17 | ClickHouse 25.8 |
| --- | --- | --- |
| Daily events per event type, whole year | 674 to 1,103 ms | 35 to 50 ms |
| Distinct users per month (`count(DISTINCT)` vs `uniqExact`) | 984 to 1,689 ms | 19 to 61 ms |
| Exact p95 latency per event type (`percentile_cont` vs `quantileExactInclusive`) | 1,215 to 1,549 ms | 32 to 51 ms |
| Top 3 paths for every tenant (`row_number()` vs `LIMIT 3 BY`) | 170 to 198 ms | 33 to 52 ms |
| Server error rate by plan, events joined to tenants | 141 to 218 ms | 28 to 65 ms |
| One tenant, one month, events per day (index lookup, 36 rows) | 0.17 to 0.26 ms | 6 to 10 ms |
| Storage for the events table | 147 MB (87 MB heap + indexes) | 18 MiB compressed |

Three things to take from it:

- **Postgres wins the lookup.** For one tenant's month, the B-tree index finds 36 rows and Postgres answers in a fraction of a millisecond. ClickHouse's sparse index reads whole 8,192-row granules and has more fixed overhead per query. If your analytics are mostly "this customer, this week", Postgres is the right tool.
- **Full-table aggregations are where the gap opens**, 3x to 50x here, and these are exactly the queries dashboards run. Each Postgres query above scans every row of the table: `EXPLAIN (ANALYZE, BUFFERS)` for the p95 query shows a sequential scan of all 11,088 pages and an external merge sort that spills about 25 MB to disk. Raising `work_mem` to 64 MB brought it to 750 to 1,150 ms: better, still an order of magnitude off.
- **A million rows is small.** Both engines scan every row for these shapes, so time grows with the table. Postgres is already near a second at one million events; most products that log events reach tens or hundreds of millions.

Here are the ClickHouse versions of the five full-table queries:

{{sql:sql/01-dashboard-shapes.sql}}

## Why the gap: what each engine reads

ClickHouse stores each column separately and compressed, and reads only the columns a query names. Postgres reads whole rows, so a two-column aggregate pays for all nine columns.

{{sql:sql/02-what-gets-read.sql}}

On the seed, the `avg(latency_ms)` query read 5.0 MB from ClickHouse, against 45.2 MB for `SELECT *` over the same table. The tenant lookup read 16,384 rows to return 36, which is the trade-off behind the first table: ClickHouse is built to scan a lot of data fast, not to find a few rows with no overhead.

## When Postgres is enough

- Analytics are per entity and indexed: one customer's orders, one account's activity this month.
- Aggregate queries over the whole table run under your latency budget at the row counts you expect in a year, with headroom.
- Reporting can be precomputed: a nightly rollup table or a materialized view refreshed off-peak covers the dashboards.
- Analytics traffic does not compete with transactions. A read replica for reporting solves this for a long time.
- You need transactional consistency between the app's writes and the numbers on screen.

## Signs it is time to add ClickHouse

- Dashboard queries scan most of a table that grows by millions of rows a month, and you keep adding indexes or rollup tables to stay ahead.
- Customers ask for flexible analytics: any date range, any breakdown, distinct counts, percentiles. Precomputation cannot cover every combination.
- `count(DISTINCT)`, `percentile_cont`, and window functions over events dominate your slow-query log.
- The events or logs table is larger than the rest of the database combined, and its vacuum, backups and replicas are driven by data that is only ever appended and aggregated.
- You are building analytics as a product feature (embedded dashboards, usage-based billing, an API), not internal reporting.

## Moving data from Postgres to ClickHouse

| Option | Freshness | Updates and deletes | Effort | Use it when |
| --- | --- | --- | --- | --- |
| **CDC** from the Postgres WAL: PeerDB (open source; ClickHouse Inc. acquired it in 2024 and it powers ClickHouse Cloud's ClickPipes Postgres CDC), or Debezium into Kafka | Seconds | Arrive as new versions; ReplacingMergeTree resolves them | A replication slot and a pipeline to run | The default for mutable tables and for most teams |
| **Dual write**: the app writes each event to Postgres and ClickHouse | Immediate | You handle them in app code | Small to start, retries and backfills are yours | Append-only events the app already emits, often only to ClickHouse |
| **Batch pull** with the `postgresql()` table function on a schedule | Minutes to hours | Re-pull or full reload | One `INSERT ... SELECT` | Small or slowly changing tables, prototypes |
| **Query in place** with the `PostgreSQL` table engine | Live | Live | A table definition | Small dimension tables joined into ClickHouse queries |
| **MaterializedPostgreSQL** database engine | Seconds | Replicated | Server-side replication | Only for experiments: it is experimental and disabled by default in 25.8 (`allow_experimental_database_materialized_postgresql = 0`) |

Batch pulls are the quickest to try. ClickHouse pushes simple filters and the selected columns down to Postgres, including a scalar subquery evaluated first. This incremental pull ran against the Postgres above, and the Postgres log shows it received `COPY (SELECT "event_id", "tenant_id", "occurred_at" FROM "events" WHERE "event_id" > 400000) TO STDOUT`:

```sql
-- Run on ClickHouse; not part of the CI job, which has no Postgres.
INSERT INTO events_from_pg
SELECT event_id, tenant_id, occurred_at
FROM postgresql('postgres-host:5432', 'app', 'events', 'readonly_user', 'password')
WHERE event_id > (SELECT max(event_id) FROM events_from_pg);
```

### What CDC lands in

CDC tools write every insert, update and delete as a new row with a version, into a `ReplacingMergeTree` ordered by the Postgres primary key. Background merges keep the latest version; `FINAL` applies that at query time.

{{sql:sql/03-cdc-target.sql}}

Rules that follow from it:

- **Order the table by the Postgres primary key**, or versions of the same row will not replace each other.
- **Read with `FINAL`** (or `argMax(col, _version)` grouped by key) when exact current state matters. Without it, a row updated since the last merge is counted more than once: above, four stored rows for two subscriptions.
- **Append-only tables do not need any of this.** Events are never updated, so CDC or dual writes can land them in a plain `MergeTree`, which is what the seed's `events` table is.

For schema choices on the ClickHouse side (`ORDER BY`, `LowCardinality`, partitioning, nullable columns), see [ClickHouse schema design for application developers](/blog/clickhouse-schema-design-for-application-developers). For translating queries, see [Postgres and MySQL to ClickHouse SQL equivalents](/blog/postgres-mysql-to-clickhouse-sql-equivalents).

## Serving the numbers to your app

Once the data is in ClickHouse, the app needs one definition of "events", "active users" and "p95" that dashboards, APIs and agents share. With `@hypequery/datasets` that is a dataset over the ClickHouse table:

```typescript
import { between, dataset, dimension, measure } from '@hypequery/datasets';

export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
  },
  measures: {
    events: measure.count('eventId'),
    activeUsers: measure.countDistinct('userId'),
    p95LatencyMs: measure.percentile('latencyMs', 0.95),
  },
});

const monthly = await analytics.execute(Events, {
  by: 'month',
  dimensions: ['eventType'],
  measures: ['events', 'activeUsers', 'p95LatencyMs'],
  filters: [between('occurredAt', '2026-01-01 00:00:00', '2026-06-30 23:59:59')],
});
```

`analytics` is `createDatasetClient({ queryBuilder: createQueryBuilder({ url, username, password, database }) })`. For tenant-scoped analytics behind an API, the [multi-tenant embedded analytics example](/examples/multi-tenant-embedded-analytics) adds `tenantKey` and `@hypequery/serve`. The `postgres-app-clickhouse-analytics` example covers the full path from a Postgres app to a ClickHouse-backed dashboard.

## Pitfalls

- **Moving transactions to ClickHouse.** On a default 25.8 server `BEGIN TRANSACTION` fails with `Transactions are not supported` (they exist only as an experimental feature), there are no foreign keys, and updates are rewrites. Keep orders, users and billing writes in Postgres.
- **Forgetting `FINAL` on CDC tables.** Counts drift upwards between merges. Add it to the dataset's source query, or materialize the latest state.
- **Small, frequent inserts.** Each `INSERT` creates a part. Batch rows (thousands per insert) or use async inserts; CDC tools batch for you.
- **Joins.** On 25.8 the default `join_algorithm` is `direct,parallel_hash,hash`: hash joins that keep one side in memory. Joining a large fact table to small dimension tables (events to tenants) is the comfortable case; large-to-large joins belong in a pre-joined table.
- **Consistency.** With CDC the analytics are seconds behind; with batch pulls, minutes or hours. Show the data's age on dashboards that users act on.

## Reproduce the Postgres numbers

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17-alpine
sleep 5   # let Postgres finish initialising
curl -s 'http://localhost:8123/?user=default&password=hypequery&database=hypequery_examples' \
  --data-binary 'SELECT * FROM events FORMAT CSV' > events.csv
docker cp events.csv pg:/tmp/events.csv
docker exec -i pg psql -U postgres <<'SQL'
CREATE TABLE events (event_id bigint PRIMARY KEY, tenant_id integer NOT NULL, user_id integer NOT NULL,
  event_type text NOT NULL, path text NOT NULL, status_code smallint NOT NULL, latency_ms integer NOT NULL,
  device text NOT NULL, occurred_at timestamptz NOT NULL);
\copy events FROM '/tmp/events.csv' WITH (FORMAT csv)
CREATE INDEX events_tenant_time ON events (tenant_id, occurred_at);
VACUUM ANALYZE;
EXPLAIN (ANALYZE, BUFFERS)
SELECT event_type, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM events GROUP BY 1;
SQL
```

The ClickHouse side is the [Docker Compose guide](/guides/clickhouse-docker-compose) plus `pnpm seed`. Load `tenants` the same way for the join query.

## FAQ

### Is ClickHouse faster than Postgres?

For aggregations over many rows, yes: 3x to 50x on one million events in the tests above, and the gap grows with the data. For finding a few rows by key, no: Postgres answered an indexed lookup in under a millisecond against 6 to 10 ms for ClickHouse.

### Can ClickHouse replace Postgres?

Not for an application's transactional data. Use Postgres for writes that need transactions and constraints, and ClickHouse for the analytical copy.

### How do I replicate Postgres to ClickHouse?

CDC from the write-ahead log (PeerDB, ClickPipes in ClickHouse Cloud, or Debezium and Kafka) into ReplacingMergeTree tables is the common path. For a first version, a scheduled `INSERT ... SELECT FROM postgresql(...)` works for small tables.

### Can ClickHouse query Postgres directly?

Yes, with the `postgresql()` table function or the `PostgreSQL` table engine. Filters and column lists are pushed down, but every matching row still has to be read by Postgres and sent over the network, so it suits small tables and backfills, not heavy aggregations.

## Related

- [Run ClickHouse with Docker Compose](/guides/clickhouse-docker-compose): the local setup these numbers came from.
- [Top N per group with LIMIT BY](/recipes/top-n-per-group-limit-by): the `row_number()` replacement from the table above.
- [Materialized view rollups](/examples/materialized-view-rollups): precompute the heaviest dashboards on the ClickHouse side too.
- [Postgres and MySQL to ClickHouse SQL equivalents](/blog/postgres-mysql-to-clickhouse-sql-equivalents) and [ClickHouse schema design for application developers](/blog/clickhouse-schema-design-for-application-developers).
