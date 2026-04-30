---
title: "ClickHouse Query Builders for TypeScript: What Your Options Actually Are"
description: "A practical comparison of the real TypeScript options for ClickHouse: raw client, Kysely, Cube, and hypequery, with the tradeoffs each one leaves you holding."
seoTitle: "ClickHouse Query Builder for TypeScript: Options and Tradeoffs"
seoDescription: "Comparing ClickHouse query builders for TypeScript? See where @clickhouse/client, Kysely, Cube, and hypequery fit, and where each option stops helping."
pubDate: 2026-04-23
heroImage: ""
slug: clickhouse-query-builder-typescript
status: published
---

If you are running ClickHouse from TypeScript, the missing piece usually does not show up on day one. It shows up when the first raw query becomes the fifth one, the row types start drifting, and the backend needs something more reusable than SQL strings plus casts.

This post covers the realistic options in 2026: what each one is good at, where it stops, and which tradeoff you are actually making.

## What a query builder actually is (and why ClickHouse makes it harder)

A query builder lets you write:

```typescript
db.table("orders")
  .select("total_revenue", "order_date")
  .where("status", "=", "completed")
  .groupBy("order_date")
  .execute()
```

Instead of:

```typescript
await client.query({
  query: `SELECT total_revenue, order_date
          FROM orders
          WHERE status = 'completed'
          GROUP BY order_date`,
  format: "JSONEachRow",
})
```

The SQL string version works. The problems start when you need to share query logic across contexts, apply conditional filters, or maintain type safety across schema changes. At that point, string concatenation gets brittle fast.

ClickHouse makes this harder than Postgres or MySQL for two reasons.

First, the type system doesn't map cleanly to TypeScript. `DateTime` comes back as a `string`, not a `Date`. `UInt64` comes back as a `string`. `Nullable(T)` needs explicit handling. A query builder that doesn't account for this gives you types that compile but lie at runtime.

Second, ClickHouse-specific syntax matters. `ARRAY JOIN`, `SAMPLE`, `PREWHERE`, `dictGet()`, CTEs with `withScalar` — generic query builders built for Postgres don't emit this syntax natively.

## Option 1: @clickhouse/client (raw)

The official ClickHouse JS client is the baseline. It connects, it queries, it supports streaming. TypeScript is supported via a generic on `client.query<T>()`.

```typescript
const result = await client.query({
  query: "SELECT total_revenue FROM orders WHERE status = {status:String}",
  query_params: { status: "completed" },
  format: "JSONEachRow",
})
const rows = await result.json<{ total_revenue: string }>()
```

**What you get:** full ClickHouse access, streaming, inserts, connection pooling.

**What you don't get:** query composition, no builder API, types are manual annotations (you write `{ total_revenue: string }` yourself — nothing checks it against the schema), no HTTP API layer, no OpenAPI docs. Every context (script, route handler, React hook) needs its own implementation.

The raw client is the right choice if you're writing one-off scripts or need low-level control over a complex query. For an analytics layer with shared query logic, it's the starting point — not the destination.

## Option 2: Kysely

Kysely is a TypeScript query builder with excellent ergonomics. It works with Postgres, MySQL, and SQLite natively, and a community ClickHouse dialect exists.

```typescript
const result = await db
  .selectFrom("orders")
  .select(["total_revenue", "order_date"])
  .where("status", "=", "completed")
  .execute()
```

**What you get:** excellent TypeScript inference, composable query building, a familiar API for anyone coming from Knex or Drizzle.

**What you don't get:** ClickHouse-native type mappings (DateTime still comes back as `string` but Kysely may infer `Date`), no schema introspection to generate the interface definitions, no HTTP layer or OpenAPI generation, ClickHouse-specific syntax like `PREWHERE`, `dictGet()`, or `withScalar` CTEs aren't supported natively.

Kysely is a strong choice if you're already using it for Postgres and want something familiar. For a ClickHouse-primary analytics layer, you'll hit the edges.

## Option 3: Cube

Cube is a semantic layer — a higher-level abstraction where you define measures and dimensions in a schema file, and Cube generates and caches the SQL.

```yaml
measures:
  - name: total_revenue
    sql: SUM(total_revenue)
    type: sum
```

**What you get:** pre-aggregations, caching, a REST and GraphQL API, a JavaScript SDK.

**What you don't get:** direct TypeScript query composition. Cube's model is schema-definition-first, not code-first. If you want to write TypeScript that constructs ClickHouse queries dynamically, Cube is working at the wrong level of abstraction. It's better suited to BI-facing teams than TypeScript backend developers.

## Option 4: hypequery

hypequery is a TypeScript-first query builder built specifically for ClickHouse. It generates TypeScript types from your live ClickHouse schema via the CLI, so the types match what actually comes back over the wire — including ClickHouse-specific mappings.

```typescript
import type { DB } from "./generated-schema"

const rows = await db
  .table("orders")
  .select("total_revenue", "order_date")
  .where("status", "=", "completed")
  .groupBy("order_date")
  .execute()

// rows: { total_revenue: string; order_date: string }[]
// correct — matches what ClickHouse actually returns
```

The type generation step runs against the real schema:

```bash
npx @hypequery/cli generate
```

This emits a `generated-schema.ts` file with correct TypeScript types for every table and column, including ClickHouse-specific mappings that hand-written interfaces typically get wrong.

ClickHouse-native features the query builder supports natively: `PREWHERE`, `ARRAY JOIN`, `withScalar()` for typed CTEs, `expr.ch.dictGet()` and other predicate helpers, `SAMPLE` for approximate queries, and window functions.

Beyond the query builder: hypequery's `@hypequery/serve` package exposes any defined query as an HTTP endpoint with auto-generated OpenAPI docs. The same query that runs inline can be served over HTTP without rewriting it. `@hypequery/react` wraps queries in typed React hooks.

## How to choose

| | @clickhouse/client | Kysely + dialect | hypequery |
|---|---|---|---|
| Query builder | No | Yes | Yes |
| TypeScript types | Manual | Manual | Generated from schema |
| ClickHouse type accuracy | Manual | Partial | Correct |
| ClickHouse-native syntax | Via raw SQL | Limited | Full support |
| HTTP API layer | Manual | Manual | Built-in |
| OpenAPI docs | Manual | Manual | Auto-generated |
| React hooks | Manual | Manual | Built-in |

If you're evaluating query builders for a ClickHouse analytics layer in TypeScript, hypequery is the only option designed specifically for this use case. The others are either too low-level, too Postgres-shaped, or too abstracted.

## Getting started

```bash
# install the core query builder
npm install @hypequery/clickhouse

# generate types from your live schema
npx @hypequery/cli generate
```
