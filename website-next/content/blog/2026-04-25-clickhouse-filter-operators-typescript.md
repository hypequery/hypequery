---
title: "ClickHouse Filter Operators in TypeScript — WHERE Conditions with hypequery"
description: "How to express ClickHouse filters in TypeScript with query_params in @clickhouse/client and typed where-chains in hypequery."
seoTitle: "ClickHouse Filter Operators TypeScript — WHERE, IN, LIKE, BETWEEN"
seoDescription: "How to express ClickHouse filters in TypeScript with query_params in @clickhouse/client and typed where-chains in hypequery."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-filter-operators-typescript
status: published
---

Filtering ClickHouse from TypeScript is mostly a choice between two styles: parameterized SQL strings with `@clickhouse/client`, or a typed `.where()` chain in hypequery. Both are valid. The difference is how much query structure and type checking you want the compiler to carry for you.

## Raw client: `query_params`

The official ClickHouse Node.js client uses `query_params` for parameterized queries. The parameter syntax is `{name: Type}` inside the SQL string:

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({ url: 'http://localhost:8123' });

const result = await client.query({
  query: `
    SELECT event_type, count() AS events
    FROM events
    WHERE tenant_id = {tenant_id: UInt32}
      AND created_at >= {from: DateTime}
      AND created_at < {to: DateTime}
      AND event_type = {event_type: String}
    GROUP BY event_type
  `,
  query_params: {
    tenant_id: 42,
    from: '2026-04-01 00:00:00',
    to: '2026-05-01 00:00:00',
    event_type: 'page_view',
  },
  format: 'JSONEachRow',
});

const rows = await result.json<{ event_type: string; events: string }>();
```

This is safe — the `{name: Type}` syntax prevents SQL injection. The ClickHouse server receives the query template and the parameters separately and substitutes them server-side.

The friction is the boilerplate. Every filter requires three things: a placeholder in the SQL string with the right ClickHouse type name, an entry in `query_params`, and manual type annotation on the result. Adding or removing a filter means editing the SQL string and the params object in sync. The TypeScript compiler doesn't verify that `{tenant_id: UInt32}` in the SQL string matches what's in `query_params`.

**String interpolation without query_params is unsafe** — never do this:

```typescript
// DO NOT DO THIS — SQL injection risk
const query = `SELECT * FROM events WHERE tenant_id = ${tenantId}`;
```

Always use `query_params` or `{name: Type}` syntax when working with the raw client.

## hypequery's typed `.where()` operators

hypequery wraps the same ClickHouse client underneath but exposes filters as typed method calls. The schema generator creates column types from your actual ClickHouse schema, so TypeScript knows that `tenant_id` is `UInt32` and that `email` is `String`.

The filter operators available in hypequery are the builder's typed operator strings:

| Operator | SQL equivalent | Example |
|----------|---------------|---------|
| `'eq'` | `col = val` | `.where('status', 'eq', 'active')` |
| `'neq'` | `col != val` | `.where('status', 'neq', 'deleted')` |
| `'gt'` | `col > val` | `.where('amount', 'gt', 100)` |
| `'lt'` | `col < val` | `.where('amount', 'lt', 1000)` |
| `'gte'` | `col >= val` | `.where('created_at', 'gte', from)` |
| `'lte'` | `col <= val` | `.where('created_at', 'lte', to)` |
| `'like'` | `col LIKE val` | `.where('email', 'like', '%@company.com')` |
| `'in'` | `col IN (...)` | `.where('status', 'in', ['active', 'trial'])` |
| `'notIn'` | `col NOT IN (...)` | `.where('plan', 'notIn', ['free', 'cancelled'])` |

## Basic Usage

First, generate your schema types:

```bash
npx @hypequery/cli generate --output ./schema.ts
```

Then build typed queries:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

const result = await db
  .table('events')
  .select('event_type', 'count() AS events')
  .where('tenant_id', 'eq', 42)
  .where('created_at', 'gte', '2026-04-01 00:00:00')
  .where('created_at', 'lt', '2026-05-01 00:00:00')
  .where('event_type', 'eq', 'page_view')
  .groupBy(['event_type'])
  .execute();
```

Multiple `.where()` calls are combined with AND. For OR conditions, use `.orWhere()` or an expression builder.

## IN and NOT IN Filters

Pass an array as the value:

```typescript
// Filter to specific statuses
const active = await db
  .table('subscriptions')
  .select('user_id', 'plan', 'created_at')
  .where('tenant_id', 'eq', tenantId)
  .where('status', 'in', ['active', 'trial', 'past_due'])
  .execute();

// Exclude churned users
const retained = await db
  .table('users')
  .select('user_id', 'count() AS events')
  .where('tenant_id', 'eq', tenantId)
  .where('plan', 'notIn', ['cancelled', 'expired'])
  .groupBy(['user_id'])
  .execute();
```

Empty arrays in `'in'` conditions will produce a SQL error — guard against this if the array comes from user input.

## LIKE Filters

ClickHouse LIKE uses `%` as wildcard. The `'like'` operator passes the pattern through directly:

```typescript
// Domain-based filter
const companyUsers = await db
  .table('users')
  .select('user_id', 'email', 'created_at')
  .where('tenant_id', 'eq', tenantId)
  .where('email', 'like', '%@acme.com')
  .execute();

// Prefix match
const apiEvents = await db
  .table('events')
  .select('event_type', 'count() AS cnt')
  .where('tenant_id', 'eq', tenantId)
  .where('page_path', 'like', '/api/%')
  .groupBy(['event_type'])
  .execute();
```

For case-insensitive matching, use `ilike` in raw SQL — hypequery's `'like'` operator is case-sensitive, matching ClickHouse's default behavior.

## OR Conditions and Expressions

When a filter cannot be expressed as a straight AND chain, use `.orWhere()` or an expression builder:

```typescript
const result = await db
  .table('events')
  .select('page_path', 'count() AS views')
  .where('tenant_id', 'eq', tenantId)
  .where('created_at', 'gte', from)
  .where('created_at', 'lt', to)
  .where('event_type', 'eq', 'page_view')
  .orWhere('event_type', 'eq', 'screen_view')
  .where('page_path', 'like', '/docs/%')
  .groupBy(['page_path'])
  .orderBy('views', 'DESC')
  .limit(20)
  .execute();
```

If you specifically need ClickHouse `PREWHERE`, that is still a raw SQL concern today rather than a dedicated builder helper. See [PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where) for where that tradeoff matters.

## Type Safety: Why It Matters

hypequery's operators are type-checked against the column type from the schema. If `tenant_id` is `UInt32` in ClickHouse, passing a string throws a TypeScript error at build time, not a runtime error from ClickHouse. If `created_at` is `DateTime`, you can't accidentally pass a number.

Compare the two approaches for a query with five filter conditions:

```typescript
// @clickhouse/client — manually maintained SQL + params
const result = await client.query({
  query: `
    SELECT page_path, count() AS views
    FROM events
    WHERE tenant_id = {tenant_id: UInt32}
      AND event_type = {event_type: String}
      AND created_at >= {from: DateTime}
      AND created_at < {to: DateTime}
      AND status IN ({statuses: Array(String)})
    GROUP BY page_path
    ORDER BY views DESC
    LIMIT 20
  `,
  query_params: { tenant_id: 42, event_type: 'page_view', from, to, statuses: [...] },
  format: 'JSONEachRow',
});

// hypequery — typed, composable
const result = await db
  .table('events')
  .select('page_path', 'count() AS views')
  .where('tenant_id', 'eq', 42)
  .where('event_type', 'eq', 'page_view')
  .where('created_at', 'gte', from)
  .where('created_at', 'lt', to)
  .where('status', 'in', [...])
  .groupBy(['page_path'])
  .orderBy('views', 'DESC')
  .limit(20)
  .execute();
```

The hypequery version is shorter, the column names are checked against the schema, and the operator strings are a closed union type — a typo like `'==='` fails TypeScript compilation rather than producing a runtime SQL error.

---

Related: [ClickHouse Query Builder](/clickhouse-query-builder) · [ClickHouse TypeScript Guide](/clickhouse-typescript) · [hypequery vs @clickhouse/client](/compare/hypequery-vs-clickhouse-client)
