---
title: "hypequery vs Kysely: Two Different Bets on Type Safety"
description: "Kysely is an excellent TypeScript query builder. On ClickHouse, the tradeoffs change. Here's where hypequery fits and what each tool optimizes for."
seoTitle: "hypequery vs Kysely for ClickHouse: Type-Safe Analytics Tradeoffs"
seoDescription: "Compare hypequery and Kysely for ClickHouse projects. Learn where Kysely shines, where ClickHouse type mapping gets tricky, and when hypequery is the better fit."
pubDate: 2026-04-14
heroImage: ""
slug: hypequery-vs-kysely
status: published
---

Kysely is one of the best TypeScript query builders available. If you're on Postgres, MySQL, or SQLite, it's a serious option, possibly the best one. It's composable, well-typed, has an active community, and a growing ecosystem of dialects.

For the broader framing behind this comparison, start with the [ClickHouse TypeScript](/clickhouse-typescript) pillar page. If your real question is how to build a reusable analytics layer, pair it with [ClickHouse analytics](/clickhouse-analytics).

If you're on ClickHouse, the picture changes. This post explains why and where hypequery fits in.

## The thing Kysely gets right

Kysely's core insight is that your database schema should drive your TypeScript types, not the other way around. You define an interface that mirrors your tables, pass it as a type parameter to the query builder, and from that point on, the type checker knows what every column is named, what type it holds, and whether it's nullable.

```typescript
import { Kysely, PostgresDialect } from 'kysely';

interface Database {
  events: {
    id: number;
    event_name: string;
    created_at: Date;
    user_id: number | null;
  };
}

const db = new Kysely<Database>({ dialect: new PostgresDialect(config) });

const result = await db
  .selectFrom('events')
  .select(['event_name', 'created_at'])
  .where('event_name', '=', 'page_view')
  .execute();
```

This is excellent. The query builder is fully typed. Autocomplete works. Type errors surface at compile time. Renaming a column in the interface immediately flags every query that references it.

The gap is the interface itself: you write it by hand.

## The ClickHouse problem

ClickHouse isn't a general-purpose relational database. It's a columnar analytics database with its own type system and its own conventions around how data is actually returned over the wire.

`DateTime` in ClickHouse doesn't come back as a JavaScript `Date`. It comes back as a string. `UInt64` can exceed JavaScript's safe integer range, so it comes back as a string too. `Nullable(T)` maps to `T | null`, but only if you know to write it that way.

If you're hand-writing the Kysely interface for a ClickHouse table, you have to know all of this. Get it wrong and TypeScript will trust you. The type can say `Date` and the runtime can still give you a string.

Kysely does have a community ClickHouse dialect. It handles the connection. It does not solve the runtime type mapping problem for you.

That runtime mapping gap is exactly what the [ClickHouse TypeScript](/clickhouse-typescript) pillar and the type-problem article are trying to make explicit.

## What hypequery does differently

hypequery generates the interface from your live schema.

```bash
npx hypequery generate --output analytics/schema.ts
```

The CLI connects to your ClickHouse instance, reads the schema, and emits a TypeScript file that maps each ClickHouse type to its actual runtime equivalent. `DateTime` becomes `string`. `UInt64` becomes `string`. `Nullable(String)` becomes `string | null`.

```typescript
export interface Schema {
  events: {
    event_name: string;
    created_at: string; // DateTime -> string
    user_id: string | null; // Nullable(UInt64) -> string | null
    properties: string;
  };
}

const result = await db
  .table('events')
  .select(['event_name', 'created_at'])
  .where('event_name', 'eq', 'page_view')
  .execute();
```

When the schema changes, rerun the generator. You don't maintain the interface manually.

## Beyond the query builder

This is where the two tools diverge more sharply.

Kysely is a query builder. A very good query builder. It produces typed SQL that gets sent to your database. What you do with the results, how you expose them, how you share queries across contexts, how you document the endpoints, is out of scope.

hypequery is designed for a specific use case: building an analytics layer that needs to work across multiple consumers. The same query definition can run inline, be exposed as an HTTP endpoint via `@hypequery/serve`, be consumed in React, or be called by another service.

```typescript
const { query, serve } = initServe({
  context: () => ({ db }),
});

const topEvents = query({
  query: async ({ ctx }) =>
    ctx.db
      .table('events')
      .select(['event_name'])
      .count('*', 'total')
      .groupBy(['event_name'])
      .orderBy('total', 'DESC')
      .limit(10)
      .execute(),
});

const api = serve({
  queries: { topEvents },
});
```

Kysely has no equivalent of this end-to-end analytics layer. It's not trying to. The use case is different.

## What you give up with hypequery

**Kysely's ecosystem is much larger.** Plugins, community dialects, adapters, and migration tooling have been built for years. hypequery is younger and much smaller.

**Kysely's query builder is more compositionally flexible.** Because Kysely is database-agnostic, its API handles a wider range of SQL patterns. hypequery's builder is ClickHouse-specific and focused on analytics query patterns.

**Kysely works across databases.** If your stack includes Postgres for transactional data and ClickHouse for analytics, Kysely can span both. hypequery is ClickHouse-only.

## The honest summary

| | Kysely | hypequery |
|---|---|---|
| Database support | Postgres, MySQL, SQLite, ClickHouse via community dialect | ClickHouse only |
| Type generation | Manual interface definition | Generated from live schema |
| ClickHouse type mapping | You manage it | Handled by the CLI |
| Query builder flexibility | Very high | Analytics-focused |
| HTTP layer | Not included | `@hypequery/serve` |
| React integration | Not included | `@hypequery/react` |
| OpenAPI docs | Not included | Supported from schemas and metadata |
| Community size | Large and growing | Smaller and earlier |

If you're on Postgres and want the best TypeScript query builder available, use Kysely.

If you're on ClickHouse and need type safety that reflects ClickHouse's actual runtime behavior, plus a path from queries to APIs, hypequery is the more direct route.

If you're on ClickHouse and have simple needs and don't mind writing the type interface by hand, Kysely with the community dialect is still viable. The tradeoff is explicit: you own the type accuracy.

## Getting started with hypequery

```bash
npm install @hypequery/clickhouse @clickhouse/client
npx hypequery generate --output analytics/schema.ts
```

If you're evaluating both tools, start with the [Quick Start](https://hypequery.com/docs/quick-start) and then compare the generated schema flow against your current hand-written interfaces. After that, read [ClickHouse analytics](/clickhouse-analytics) if the bigger question is how those queries get reused across APIs, dashboards, and services.
