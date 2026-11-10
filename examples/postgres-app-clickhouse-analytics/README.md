# Add ClickHouse analytics to a Postgres + Drizzle app

Keep accounts in Postgres with Drizzle, serve usage from ClickHouse with hypequery, and join the two by account id in one API route.

## Demo

```text
$ curl -s 'localhost:3000/api/accounts?plan=enterprise'      usage since 2026-10-01

                     ── Postgres (Drizzle) ──────────────────   ── ClickHouse (hypequery) ──   joined
account              seats  owner         renews               active users  events          seat use
Orbit Software       158    Ines Duarte   2027-09-30           99            8,117           63%
Iris Works           160    Ines Duarte   2027-04-03           116           9,612           73%
Helix Metrics        155    Sam Okafor    2027-08-29           84            9,121           54%
Orbit Metrics        155    Ines Duarte   2027-10-10           18            3,315           12%
Pioneer Analytics    150    Sam Okafor    2027-03-07           12            1,105            8%
...                                                                                          (22 accounts)
```

Seat use is the number neither database has alone: seats live in Postgres, active users in ClickHouse. `pnpm dev` also serves the same table as an HTML page at http://localhost:3000.

## Install

```bash
npx @hypequery/cli create postgres-app-clickhouse-analytics -y
cd postgres-app-clickhouse-analytics
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

No Postgres server needed: without `DATABASE_URL` the app runs Postgres in-process with [PGlite](https://pglite.dev) and seeds it on start. To use your own Postgres, set `DATABASE_URL` and run `pnpm db:seed` once.

## What it shows

- **OLTP stays in Postgres with your ORM** (`db/schema.ts`): a Drizzle `accounts` table owns what users edit: plan, seats, account owner, renewal date. Nothing about it changes when you add ClickHouse.
- **Events and analytics live in ClickHouse behind a dataset** (`analytics/datasets.ts`): `Usage` over the seed's 1M `events` defines `events`, `activeUsers` and `lastSeenAt` once, with typed dimensions.
- **The join happens in the app, by id** (`src/accounts.ts`): one Drizzle query picks the accounts, one hypequery query fetches usage for exactly those ids with `inList`, and a `Map` merges them. Two round trips, no N+1, no cross-database SQL.
- **Driver-agnostic Postgres** (`db/client.ts`): PGlite by default, `node-postgres` when `DATABASE_URL` is set, same Drizzle API either way.
- **Proven by the smoke test** (`test/smoke.test.ts`): the response shape, per-account usage equal to raw ClickHouse SQL, every account present (including idle ones), and a 400 on a bad `since`.

## Key file

`src/accounts.ts`, the whole pattern:

```ts
export async function listAccountsWithUsage(opts: { plan?: string; since?: string } = {}) {
  const rows = await pgdb
    .select()
    .from(accounts)
    .where(opts.plan ? eq(accounts.plan, opts.plan) : undefined)
    .orderBy(asc(accounts.id));
  if (rows.length === 0) return [];

  const usage = await analytics.execute(Usage, {
    dimensions: ['tenantId'],
    measures: ['events', 'activeUsers', 'lastSeenAt'],
    filters: [inList('tenantId', rows.map((a) => a.id)), gte('occurredAt', opts.since ?? DEFAULT_SINCE)],
    limit: rows.length,
  });
  const byId = new Map(usage.data.map((u) => [Number(u.tenantId), u]));

  return rows.map((account) => {
    const u = byId.get(account.id);
    const activeUsers = Number(u?.activeUsers ?? 0);
    return {
      ...account,
      events: Number(u?.events ?? 0),
      activeUsers,
      seatUtilization: Math.round((activeUsers / account.seats) * 100) / 100,
      lastSeenAt: u?.lastSeenAt ? String(u.lastSeenAt) : null,
    };
  });
}
```

## Architecture

```text
browser / your frontend          your API (Hono)                                  databases
───────────────────────          ─────────────────────────────────────────        ─────────────────────────────
GET /api/accounts?plan=…  ────▶  listAccountsWithUsage()
                                   1. pgdb.select().from(accounts)   ──────────▶  Postgres  accounts (OLTP)
                                   2. analytics.execute(Usage,
                                        inList('tenantId', ids))     ──────────▶  ClickHouse events (1M rows)
                                   3. join by id, add seatUtilization
          ◀── [{ name, seats, owner, renewsOn, activeUsers, events, seatUtilization }]

your app writes events straight to ClickHouse; account rows can follow via CDC (see "Adapt it")
```

## Why not just Postgres?

`pnpm bench` copies the seed's 1,000,000 events into Postgres and runs the same 12-month per-account rollup (count, distinct users, average latency, last event) on both. On a laptop with both databases in Docker at default settings, Postgres 17 took **about 1.7 s** (median of 5, with an index on `(tenant_id, occurred_at)`) and ClickHouse 25.8 took **30 to 50 ms**, roughly 40 to 60 times faster. PGlite, the in-process default, took 5.2 s. The gap grows with the table: Postgres reads every row's full tuple, while ClickHouse reads only the compressed columns the query names. Postgres is still the right home for the `accounts` row a user edits and expects to read back immediately. Run `DATABASE_URL=postgres://… pnpm bench` to get the number on your own hardware.

## Adapt it

- **Getting Postgres data into ClickHouse.** This example keeps the join in the app, which works when Postgres bounds the set (a page of accounts). To filter or sort by Postgres fields across all accounts inside ClickHouse, replicate the table: [ClickPipes Postgres CDC](https://clickhouse.com/docs/integrations/clickpipes/postgres) (managed, built on PeerDB) or self-hosted [PeerDB](https://github.com/PeerDB-io/peerdb) stream changes into a `ReplacingMergeTree`; the experimental [`MaterializedPostgreSQL`](https://clickhouse.com/docs/engines/database-engines/materialized-postgresql) engine replicates without extra services; or dual-write from the app (an outbox table is safer than two writes in one request). Then add the replicated `accounts` as a hypequery relationship or a second dataset.
- **Events never touch Postgres.** Send product events straight to ClickHouse (batch inserts, or a Kafka/HTTP ingest), not through your OLTP database and CDC.
- **Prisma or TypeORM instead of Drizzle.** Only step 1 changes: `prisma.account.findMany({ where: { plan } })` or `repo.find({ where: { plan } })`. The hypequery half is identical. See [ClickHouse with an ORM](https://hypequery.com/clickhouse-orm).
- **A real Postgres.** Set `DATABASE_URL`; run `pnpm db:seed` once (or use your own migrations, e.g. drizzle-kit). To keep PGlite data across restarts, use `new PGlite('./.pglite')` in `db/client.ts`.
- **Customer-facing.** This is a staff view across accounts. For a dashboard each customer sees, add `tenantKey: 'tenant_id'` to the dataset and serve it with signed tokens, as in the multi-tenant example.
- **Translating queries.** [Postgres and MySQL to ClickHouse SQL equivalents](https://hypequery.com/blog/postgres-mysql-to-clickhouse-sql-equivalents) and [ClickHouse schema design for application developers](https://hypequery.com/blog/clickhouse-schema-design-for-application-developers) cover what changes when you move a table over.

## Related recipes

- [p95-latency](../../recipes/p95-latency): add a latency percentile to the `Usage` dataset.
- [retention-cohorts](../../recipes/retention-cohorts): cohort retention over the same events.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): the same usage data, tenant-scoped for customers.
- [materialized-view-rollups](../materialized-view-rollups): pre-aggregate the events once they outgrow raw queries.
- [nextjs-dashboard](../nextjs-dashboard): typed React hooks over hypequery datasets.

Tested on ClickHouse 25.8 and Postgres 17 (and PGlite 0.5) with `@hypequery/datasets` 0.29, `@hypequery/clickhouse` 2.14, Drizzle ORM 0.45 and Hono 4.
