---
title: "hypequery vs @clickhouse/client: What You Actually Gain"
description: "The official ClickHouse JavaScript client is solid, but it stops at connections and raw queries. Here's what hypequery adds for TypeScript analytics teams."
seoTitle: "hypequery vs @clickhouse/client: Type-Safe ClickHouse Queries in TypeScript"
seoDescription: "Compare hypequery and @clickhouse/client for ClickHouse TypeScript apps. See what you gain with generated schema types, reusable queries, and typed HTTP APIs."
pubDate: 2026-04-14
heroImage: ""
slug: hypequery-vs-clickhouse-client
status: published
---

The official ClickHouse JavaScript client is fast, well-maintained, and works. If all you need is a connection and the ability to run raw queries, it's the right tool.

If you are comparing approaches at a higher level first, the [ClickHouse TypeScript](/clickhouse-typescript) and [ClickHouse analytics](/clickhouse-analytics) pillars summarize the two core decisions behind this comparison.

But if you're building an analytics dashboard or a reporting layer in TypeScript, you'll hit a ceiling quickly. This post is about what that ceiling looks like and what hypequery does on the other side of it.

## What @clickhouse/client gives you

The official client handles the connection, the protocol, and the query execution. It supports both Node.js and the browser, it's actively maintained by the ClickHouse team, and it's the foundation everything else is built on.

A typical query looks like this:

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://your-instance.clickhouse.cloud',
  username: 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const result = await client.query({
  query: 'SELECT event_name, count() as total FROM events GROUP BY event_name',
  format: 'JSONEachRow',
});

const rows = await result.json();
// rows is effectively unknown[]
```

That `unknown[]` is the first problem. You get data back, but TypeScript has no idea what's in it. Every field access requires a cast or type assertion. Errors in the query string, a typo, a column that doesn't exist, a renamed field, surface at runtime, not at compile time.

The second problem is reuse. If the same query is needed in an API route, a dashboard component, and a scheduled job, you either write it three times or build your own abstraction on top of the client.

The third problem is serving it. There's no built-in path from raw queries to a typed HTTP endpoint with request validation or generated docs.

None of this is a criticism of the client. It's doing exactly what it promises. These are just the gaps that appear when you start building something real on top of it.

## What hypequery adds

hypequery is built on top of `@clickhouse/client`. It adds three things the client doesn't have:

1. type safety derived from your live schema
2. a query builder that enforces that schema at compile time
3. a server layer that exposes those queries as typed HTTP endpoints

### Type safety from your schema

The CLI introspects your ClickHouse schema and generates TypeScript types:

```bash
npx hypequery generate --output analytics/schema.ts
```

This produces a `schema.ts` file with a typed representation of every table, column, and runtime mapping in your database. `DateTime` becomes `string`, because that's what ClickHouse actually returns over the wire. `UInt64` becomes `string` too. `Nullable(String)` becomes `string | null`.

### A query builder that knows your schema

With the schema in place, queries are built with a typed builder instead of raw strings:

```typescript
const result = await db
  .table('events')
  .select(['event_name', 'created_at'])
  .where('event_name', 'eq', 'page_view')
  .limit(100)
  .execute();

// result: Array<{ event_name: string; created_at: string }>
```

If `event_name` doesn't exist on the `events` table, TypeScript catches it before the query runs. If you pass the wrong value type, TypeScript catches that too.

### The same query in multiple contexts

Define a query once and use it across your application without duplication:

```typescript
const topEvents = query({
  query: async ({ ctx }) => {
    return ctx.db
      .table('events')
      .select(['event_name'])
      .count('*', 'total')
      .groupBy(['event_name'])
      .orderBy('total', 'DESC')
      .limit(10)
      .execute();
  },
});

const data = await topEvents.execute();
```

That same definition can also be served over HTTP:

```typescript
const { query, serve } = initServe({
  context: () => ({ db }),
});

const api = serve({
  queries: { topEvents },
});

api.route('/top-events', api.queries.topEvents, { method: 'GET' });
```

One definition. Multiple consumers. One place to update when the schema changes.

That shift from “database client” to “analytics layer” is the main subject of the [ClickHouse analytics](/clickhouse-analytics) pillar page.

### An HTTP layer with docs

`@hypequery/serve` takes your query definitions and exposes them as typed HTTP endpoints. If you add Zod schemas, the same definitions also drive docs and OpenAPI output.

No hand-rolling API handlers for every analytics query. No manually duplicating request and response types.

## What you give up

hypequery adds an abstraction layer, and abstraction layers have costs.

**The query builder doesn't cover everything ClickHouse can do.** If you need complex window functions, non-standard ClickHouse SQL extensions, or highly optimized custom query patterns, you'll hit the edges of the builder and may need raw SQL escape hatches.

**Schema generation is explicit.** If your ClickHouse schema changes, you need to rerun the generator. The types do not update themselves.

**It's another dependency.** The official client is maintained by ClickHouse. hypequery is an additional layer. For very small scripts or prototypes, the official client plus a few assertions can be enough.

## When to use which

Use `@clickhouse/client` directly when:

- you're running ad-hoc queries or scripts
- your query logic is genuinely one-off
- you need advanced ClickHouse SQL that the builder doesn't yet support
- you're prototyping and the overhead of schema generation isn't worth it yet

Use hypequery when:

- you're building a dashboard, reporting feature, or analytics layer in TypeScript
- the same query logic needs to run in multiple contexts
- you want type safety that reflects your actual ClickHouse schema
- you want typed HTTP endpoints without hand-building the whole server layer

The two tools aren't in competition. hypequery wraps `@clickhouse/client`. The question is whether the abstraction layer earns its place in your project.

## Getting started

```bash
npm install @hypequery/clickhouse @clickhouse/client
npx hypequery generate --output analytics/schema.ts
```

If you want the current happy path, start with the [Quick Start](https://hypequery.com/docs/quick-start), then continue with [ClickHouse TypeScript](/clickhouse-typescript) or [ClickHouse analytics](/clickhouse-analytics) depending on whether your main concern is type mapping or reusable architecture.
