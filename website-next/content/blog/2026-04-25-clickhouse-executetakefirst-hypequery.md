---
title: "ClickHouse executeTakeFirst Equivalent — From Kysely to hypequery"
description: "Looking for executeTakeFirst in ClickHouse? If you're coming from Kysely, here's how hypequery handles single-row queries and what the equivalent patterns look like."
seoTitle: "ClickHouse executeTakeFirst Alternative — hypequery vs Kysely"
seoDescription: "Looking for executeTakeFirst in ClickHouse? If you're coming from Kysely, here's how hypequery handles single-row queries and what the equivalent patterns look like."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-executetakefirst-hypequery
status: published
---

If you've used [Kysely](https://kysely.dev) with Postgres or SQLite, you're familiar with `executeTakeFirst()` and `executeTakeFirstOrThrow()`. They return a single row — or undefined, or throw — instead of an array. It's a useful pattern for row-level operations.

ClickHouse is a different kind of database, and hypequery is built for it specifically. Here's how the patterns map.

## Kysely's executeTakeFirst

In Kysely:

```typescript
// Returns the first row or undefined
const user = await db
  .selectFrom('users')
  .selectAll()
  .where('id', '=', userId)
  .executeTakeFirst();

// Returns the first row or throws SelectQueryError
const user = await db
  .selectFrom('users')
  .selectAll()
  .where('id', '=', userId)
  .executeTakeFirstOrThrow();
```

This is designed for primary key lookups and row-level access patterns — the database norm when your engine is Postgres, MySQL, or SQLite. You look up a user by ID, get one row back, done.

## ClickHouse Is Not That Kind of Database

ClickHouse is a columnar analytics database. Its design optimises for:

- Aggregations over millions or billions of rows
- Scans across entire columns
- High-throughput ingestion

It is not optimised for primary key point lookups. There's no equivalent of Postgres's index scan that retrieves one row by primary key in sub-millisecond time. A ClickHouse query that touches one row still reads entire column granules (the default granule size is 8192 rows). For OLTP-style access patterns, you should be using Postgres, not ClickHouse.

That said — single-row-style queries do have legitimate uses in a ClickHouse context. Looking up the most recent event for a user, checking if a tenant has any data, fetching configuration rows. These happen, they're just not the primary pattern.

## The Closest hypequery Pattern

hypequery does not currently expose a dedicated `executeTakeFirst()` helper. `.execute()` returns an array, so the practical pattern depends on what "single row" means in your query:

- If you want the top row from a multi-row result set, add `ORDER BY ... LIMIT 1` and take `rows[0]`.
- If the query is already guaranteed to return one row because of the SQL shape, such as `count()` or `max(...)` without a `GROUP BY`, just call `.execute()` and take `rows[0]`.

For the common "latest row" case, `limit(1)` is the right pattern:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

// Most recent event for a user
const rows = await db
  .table('events')
  .select('event_type', 'created_at', 'properties')
  .where('tenant_id', 'eq', tenantId)
  .where('user_id', 'eq', userId)
  .orderBy('created_at', 'DESC')
  .limit(1)
  .execute();

const latestEvent = rows[0]; // undefined if no rows
```

This is close to `executeTakeFirst()`, but it is worth being precise about the semantics:

- `LIMIT 1` is only meaningful when the query could otherwise return many rows.
- Without an `ORDER BY`, "first row" is not a stable concept.
- For aggregate queries that already collapse to one row, `LIMIT 1` is unnecessary.

For the "or throw" variant, a small helper is easy to write:

```typescript
async function executeOne<T>(
  query: { limit: (n: number) => { execute: () => Promise<T[]> } }
): Promise<T | undefined> {
  const rows = await query.limit(1).execute();
  return rows[0];
}

async function executeOneOrThrow<T>(
  query: { limit: (n: number) => { execute: () => Promise<T[]> } }
): Promise<T> {
  const rows = await query.limit(1).execute();
  if (!rows[0]) throw new Error('Expected at least one row, got none');
  return rows[0];
}
```

## Practical Examples

**Check if a tenant has any ingested data:**

```typescript
const rows = await db
  .table('events')
  .select('count() AS total')
  .where('tenant_id', 'eq', tenantId)
  .execute();

const hasData = Number(rows[0]?.total ?? 0) > 0;
```

`count()` without a `GROUP BY` already returns one row, so `limit(1)` adds nothing here.

**Get the latest ingestion timestamp for a tenant:**

```typescript
const rows = await db
  .table('events')
  .select('max(created_at) AS last_seen')
  .where('tenant_id', 'eq', tenantId)
  .execute();

const lastSeen = rows[0]?.last_seen; // "2026-04-25 14:00:00" or null
```

Same idea: `max(...)` already returns a single-row aggregate result.

**Fetch top result from a ranking query:**

```typescript
const rows = await db
  .table('events')
  .select('page_path', 'count() AS views')
  .where('tenant_id', 'eq', tenantId)
  .where('event_type', 'eq', 'page_view')
  .groupBy(['page_path'])
  .orderBy('views', 'DESC')
  .limit(1)
  .execute();

const topPage = rows[0]; // { page_path: string; views: string } | undefined
```

This is the case where `limit(1)` really matters: the query could return many grouped rows, and you only want the highest-ranked one.

## Why ClickHouse + Kysely Is Uncommon

Kysely is a query builder designed around row-level access patterns. Its API — `selectFrom`, `insertInto`, `updateTable`, `deleteFrom` — maps directly to CRUD operations. `executeTakeFirst` is a natural part of that model.

ClickHouse's primary use is analytics queries: `GROUP BY`, aggregation functions, window functions, time-series bucketing. There's no UPDATE, no DELETE-by-row (writes go through mutations or `ReplacingMergeTree`), and no index-based point lookup. Mapping Kysely's mental model onto ClickHouse produces awkward queries — you end up fighting the API rather than working with the database.

hypequery is built around ClickHouse's actual query patterns: time-series aggregations, typed filter chains, joins, CTEs, and an escape hatch to raw SQL when you need ClickHouse-specific clauses beyond the current helper surface.

So the honest summary is: there is no one-method equivalent to Kysely's `executeTakeFirst()` today. The hypequery pattern is either:

- `orderBy(...).limit(1).execute()[0]` for "top row" queries, or
- `.execute()[0]` for aggregate queries that already return exactly one row.

The full comparison of the two approaches is at [hypequery vs Kysely](/compare/hypequery-vs-kysely).

---

Related: [hypequery vs Kysely](/compare/hypequery-vs-kysely) · [ClickHouse Query Builder](/clickhouse-query-builder) · [ClickHouse ORM Patterns](/clickhouse-orm)
