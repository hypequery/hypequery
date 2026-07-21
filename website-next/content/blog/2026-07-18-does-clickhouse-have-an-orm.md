---
title: "Does ClickHouse Have an ORM? A Practical Answer"
description: "No mature ORM exists for ClickHouse, and the architecture explains why. Here's what actually exists for TypeScript teams — the official client, typed query builders, SQL tag libraries — and what to use instead."
seoTitle: "Does ClickHouse Have an ORM? What Exists and What to Use Instead"
seoDescription: "Does ClickHouse have an ORM? Short answer: no mature ORM exists, and a traditional ORM is the wrong shape for a columnar database. A practical survey of @clickhouse/client, hypequery, chorm, and Waddler — and why Prisma, TypeORM, and Drizzle don't support ClickHouse."
pubDate: 2026-07-18
heroImage: ""
slug: does-clickhouse-have-an-orm
status: published
tags:
  - ClickHouse
  - TypeScript
---

No. There is no mature, full-featured ORM for ClickHouse — nothing comparable to Prisma or TypeORM on Postgres — and there probably never will be, because a traditional ORM is the wrong shape for the database. ClickHouse is columnar, append-oriented, and built for aggregation. The things an ORM models — row-level entities, foreign keys, transactional updates, lazy-loaded relations — either don't exist in ClickHouse or are actively discouraged by its storage engine.

**Short answer:** ClickHouse has no full ORM, but it doesn't leave you writing string-concatenated SQL either. What exists is a spectrum: the official low-level [`@clickhouse/client`](/compare/hypequery-vs-clickhouse-client), typed query builders like hypequery (schema codegen + fluent builder + semantic layer), Waddler (the Drizzle team's SQL-template-tag library with native ClickHouse support), and small OSS experiments like chorm. For application analytics in TypeScript, a typed query builder gives you the parts of an ORM you actually wanted — compile-time safety and schema-derived types — without pretending ClickHouse is a transactional row store.

This post walks through why the ORM gap exists, what each option actually does, and how to pick. If you want the broader landscape, the [ClickHouse ORM guide](/clickhouse-orm) covers it in depth; if you'd rather just get a typed client running, the [quick start](/docs/quick-start) takes about five minutes.

## Why there's no Prisma for ClickHouse

ORMs are built around a specific workload: load a row as an object, mutate it, save it back.

```sql
-- The workload an ORM models
SELECT * FROM users WHERE id = 42;
UPDATE users SET email = 'new@example.com' WHERE id = 42;
```

Every core ORM concept — entities, identity maps, dirty tracking, foreign-key relations, transactions — assumes this shape. ClickHouse's workload looks nothing like it:

```sql
-- The workload ClickHouse is built for
SELECT
  toStartOfDay(created_at) AS day,
  uniq(user_id) AS active_users,
  quantile(0.95)(duration_ms) AS p95_latency
FROM events
WHERE created_at >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day
```

The mismatches are structural, not cosmetic:

- **Columnar storage.** ClickHouse reads only the columns a query references. `SELECT *` row hydration — the ORM's bread and butter — throws that advantage away.
- **Append-oriented writes.** MergeTree tables are optimised for large batch inserts. Single-row `UPDATE` and `DELETE` are asynchronous mutations, expensive by design. An ORM's `save()` loop is an anti-pattern here.
- **No enforced foreign keys, no meaningful transactions.** The relational machinery ORMs map onto simply isn't there. Deduplication happens at merge time (ReplacingMergeTree), not through constraint enforcement.
- **Aggregation-first queries.** The typical ClickHouse query returns computed aggregates — `sum`, `uniq`, `quantile` — not entities. There's no object to map the result to; the result shape is defined by the query itself.

So "does ClickHouse have an ORM?" is really two questions. Literally: no mature one exists. Practically: you don't want one — you want type safety over the queries ClickHouse is actually good at.

## What the big TypeScript ORMs do about ClickHouse

The absence isn't for lack of demand.

**Prisma** has no native ClickHouse connector — the long-running GitHub issues ([#16174, #23292](/prisma-clickhouse)) have been open for years. The known workaround is pointing Prisma's MySQL provider at ClickHouse's MySQL-compatibility port (9004). It's experimental and breaks on anything ClickHouse-specific: arrays, `AggregateFunction` columns, most of the function library. The pattern that works in production is Prisma for your OLTP database plus a ClickHouse-native library for analytics.

**TypeORM** has [no ClickHouse support and no credible workaround](/typeorm-clickhouse). This is the clearest case of the architectural mismatch: TypeORM's entire model is entities, foreign keys, transactions, and migrations — none of which map to a columnar append-only engine.

**Drizzle** has [no native ClickHouse driver](/drizzle-clickhouse) either. The MySQL-port trick via `mysql2` exists with the same caveats as Prisma's. But the Drizzle team did build something ClickHouse-relevant: **Waddler** (waddler.drizzle.team), a SQL-template-tag library with native ClickHouse support built on `@clickhouse/client`. It gives you safe parameter interpolation via tagged templates — genuinely useful — but it's a tagged-template layer over SQL strings, not a typed query builder. Your column names and result shapes are still unchecked strings.

## What does exist for ClickHouse + TypeScript

### The official client: @clickhouse/client

The floor everyone builds on. It handles connections, formats, streaming, and parameter binding — and nothing else. You write SQL strings and assert result types by hand:

```ts
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const result = await client.query({
  query: 'SELECT region, sum(total) AS revenue FROM orders GROUP BY region',
  format: 'JSONEachRow',
});

const rows = await result.json<{ region: string; revenue: string }>();
```

Note the `revenue: string` — that's not a typo. ClickHouse returns `UInt64` and other large numerics as strings over JSON, and the compiler has no way to warn you when your hand-written assertion says `number`. Nothing checks the SQL against your schema either: rename a column and this compiles fine, then fails at runtime.

### hypequery: typed query builder + schema codegen + semantic layer

hypequery builds on `@clickhouse/client` and closes exactly that gap. One CLI command introspects your live ClickHouse schema and generates TypeScript types with the correct runtime mappings — `UInt64` → `string`, `DateTime` → `string`, `Nullable(T)` → `T | null`:

```bash
npm install @hypequery/clickhouse
npx hypequery generate
```

Then queries are checked end to end — table names, column names, operator/value types, and the result shape:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const thirtyDaysAgo = '2026-06-18 00:00:00';

const dailyUsage = await db
  .table('events')
  .countDistinct('user_id', 'active_users')
  .quantile('duration_ms', 0.95, 'p95_latency')
  .where('created_at', 'gte', thirtyDaysAgo)
  .groupByTimeInterval('created_at', '1 day')
  .orderBy('created_at', 'ASC')
  .execute();
```

Misspell `duration_ms` and the build fails. And unlike an ORM ported from the transactional world, the builder is shaped around ClickHouse's own features: `.final()` for ReplacingMergeTree dedup, `.limitBy()` for top-N-per-group, `.withCTE()`, `.settings()`, `.argMax()` and `.argMin()`, approximate aggregates. Where the builder honestly doesn't cover something (window functions, `SAMPLE`), you use `selectExpr()` for raw expressions or drop to the official client — no pretending.

For the layer above single queries — shared metric definitions, tenant isolation, time grains — `@hypequery/datasets` provides a code-first semantic layer, which is the closest thing to a useful "model" concept for analytics. The entity you want to reuse across an analytics app isn't a row; it's a metric:

```ts
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
  },
});

export const revenue = Orders.metric('revenue', { measure: 'revenue' });
```

### chorm: a small OSS ORM attempt

For completeness: [chorm](https://github.com/lawgdev/chorm) is a small open-source project that takes an ORM-flavoured approach to ClickHouse. It's worth knowing it exists, but it's a young project with a narrow surface, not something in the maturity class of Prisma or Drizzle. Its existence mostly confirms the pattern — the community keeps reaching for type safety on ClickHouse, and the entity-mapping half of the ORM idea keeps getting left behind.

### Waddler: SQL tags, not a builder

Covered above, but to place it on the spectrum: Waddler sits between the raw client and a query builder. You get safe interpolation and a pleasant authoring experience, but no schema-derived types and no compile-time checking of columns or results. If your team is happy writing SQL and just wants injection-safe parameters, it's a reasonable floor.

## Picking between them

| | SQL safety | Schema-derived types | ClickHouse-native features | Maturity |
|---|---|---|---|---|
| `@clickhouse/client` | Params only | No — hand-written assertions | All (you write the SQL) | Official |
| Waddler | Tagged templates | No | All (you write the SQL) | New, Drizzle team |
| chorm | Varies | Partial | Limited | Early-stage OSS |
| hypequery | Typed builder | Yes — generated from live schema | `FINAL`, `LIMIT BY`, CTEs, approximate aggregates natively | Active, builds on official client |
| Prisma / TypeORM / Drizzle | — | — | — | No ClickHouse support |

The honest decision tree:

1. **You mostly write SQL and want minimal dependencies** → `@clickhouse/client`, add Waddler if string interpolation makes you nervous.
2. **You're building application features on ClickHouse — dashboards, analytics APIs, multi-tenant reporting** → a typed query builder. That's the ORM-shaped need without the ORM-shaped mismatch.
3. **You came here hoping to point Prisma/Drizzle/TypeORM at ClickHouse** → keep them for your OLTP database and add a ClickHouse-native layer beside them. The MySQL-port workarounds are not production paths.

## Where to go from here

- [Query builder vs ORM for ClickHouse](/blog/query-builder-vs-orm-clickhouse) — a deeper cut on why the builder pattern fits and the ORM pattern doesn't
- [ClickHouse ORM guide](/clickhouse-orm) — the full landscape, including migration patterns from ORM-based stacks
- [The ClickHouse query builder](/clickhouse-query-builder) — day-to-day API reference for the typed builder
- [Quick start](/docs/quick-start) — schema introspection to first typed query in about five minutes
