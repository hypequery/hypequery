# Seed dataset

One deterministic ClickHouse dataset shared by every hypequery example, recipe
and guide, so numbers, screenshots and expected SQL stay consistent across the
site and the CI harness.

It models a small multi-tenant SaaS: 200 tenants, a few thousand users, one
million product events over twelve months, and subscription periods for MRR.

## Run it

```bash
docker compose -f examples/_seed/docker-compose.yml up -d --wait
pnpm seed
```

`pnpm seed` drops and recreates the `hypequery_examples` database, applies
`schema.sql`, generates every row from a fixed PRNG seed, and then compares row
counts and per-table checksums against `checksums.json`. A mismatch is a
non-zero exit with both sides printed. It takes under ten seconds.

| Command | What it does |
| --- | --- |
| `pnpm seed` | Recreate, load, verify against `checksums.json`. |
| `pnpm --filter @hypequery-examples/seed seed:check` | Verify an already-loaded database only. |
| `pnpm --filter @hypequery-examples/seed seed:write-checksums` | Recreate, load, and overwrite `checksums.json`. Only after a deliberate generator or schema change. |
| `pnpm --filter @hypequery-examples/seed run-sql -- /abs/path/a.sql ...` | Run `.sql` files statement by statement against the seed (the guides CI job). |

Connection settings come from the same env vars the repo's `testing/` specs
use, with defaults that match `docker-compose.yml`:

| Variable | Default |
| --- | --- |
| `CLICKHOUSE_URL` | `http://localhost:8123` |
| `CLICKHOUSE_USERNAME` | `default` |
| `CLICKHOUSE_PASSWORD` | `hypequery` |
| `CLICKHOUSE_DATABASE` | `hypequery_examples` |

ClickHouse is pinned to `clickhouse/clickhouse-server:25.8` (LTS). Bumping it
is a deliberate change: re-run `seed:write-checksums`, commit the new
`checksums.json`, and update the "Tested on ClickHouse" line in the guides.

## Tables

All timestamps are UTC. Events span `2025-11-01` to `2026-10-31` inclusive.

| Table | Rows | Purpose |
| --- | --- | --- |
| `tenants` | 200 | Plan (`free`, `starter`, `growth`, `enterprise`), region, industry, `created_at`. Tenant creation dates reach back to late 2024 so cohorts predate the event range. |
| `users` | 5,264 | Belong to a tenant; `signed_up_at` drives retention cohorts. Roles `admin`, `member`, `viewer`. |
| `events` | 1,000,000 | `event_type`, `path`, `status_code`, long-tailed `latency_ms`, `device`, `occurred_at`. Partitioned by month. Activity is skewed towards enterprise tenants, peaks in business hours, dips at weekends and grows through the year. |
| `subscriptions` | 127 | One row per subscription period with `plan`, `status` (`active`, `trialing`, `past_due`, `canceled`), `billing_interval`, `amount` (`Decimal(12, 2)`), `currency`, `started_at`, `ended_at`. Upgrades close one row and open another, so MRR is a point-in-time query. Free tenants have no row unless they once paid and churned. |

Which wave 1 item uses what:

- Time bucketing and the materialized view examples: `events.occurred_at` over twelve monthly partitions.
- p95 latency recipe: `events.latency_ms`, log-normal per `event_type` with a per-tenant factor, so percentiles differ by tenant.
- Retention cohorts recipe: `users.signed_up_at` plus a long-tailed per-user lifetime, so weekly cohorts decay realistically.
- Multi-tenant embedded analytics: `tenant_id` on every table, with a handful of tenants producing most events.
- MRR (later): `subscriptions.amount` and `billing_interval` (annual rows are billed 10x monthly, once a year).

## How determinism works

`src/generator.ts` draws every value from one mulberry32 PRNG seeded with
`20261101`, in a fixed order: tenants, users, events, then subscriptions. Dates
are absolute, never relative to "now". `checksums.json` records
`count()` and `sum(cityHash64(*))` per table, which is order-independent, so
the check does not depend on how ClickHouse merges parts.

The generator's tests pin a sample row with inline snapshots. If you change a
constant on purpose, update the snapshots (`vitest run -u`) and the checksums
together, and say so in the PR.
