---
title: "Stop writing the same query three times"
description: "hypequery 0.2.0 adds a query() API for the common problem where one ClickHouse query ends up reimplemented for scripts, HTTP endpoints, and frontend consumers."
seoTitle: "hypequery 0.2.0: One Query Definition for Inline and HTTP Use"
seoDescription: "Define a ClickHouse query once, execute it inline, and expose the same definition over HTTP instead of rewriting it for every context."
pubDate: 2026-04-23
heroImage: ""
slug: stop-writing-the-same-query-three-times
status: published
---

Here is a pattern that shows up in most ClickHouse TypeScript codebases eventually.

You write a revenue query inline, for a script or a cron job:

```typescript
const result = await db
  .table("orders")
  .select("total_revenue", "order_date")
  .where("status", "=", "completed")
  .execute()
```

Then you need the same query as an HTTP endpoint for your dashboard. So you write it again, this time wired into your Express or Hono route handler:

```typescript
app.get("/api/revenue", async (req, res) => {
  const result = await db
    .table("orders")
    .select("total_revenue", "order_date")
    .where("status", "=", "completed")
    .execute()
  res.json(result)
})
```

Then you need a React hook. You write it a third time, or you call the HTTP endpoint and lose the type information on the way back.

That is the real problem: one logical query becomes several implementations, and each new consumer makes drift more likely.

hypequery 0.2.0 ships a different model.

## The query object

The new release introduces a `query()` function from `initServe()`. It returns a typed query object — not a promise, not a builder chain. An object that carries the query definition and can execute it in any context.

```typescript
import { initServe } from "@hypequery/serve"
import { db } from "./db"

const { query, serve } = initServe({
  context: () => ({ db }),
})

export const revenue = query({
  query: async ({ ctx }) => {
    return ctx.db
      .table("orders")
      .select("total_revenue", "order_date")
      .where("status", "=", "completed")
      .execute()
  },
})
```

`revenue` is now a first-class object. You can pass it around, export it, compose it.

## Context 1: inline execution

The `query` object has an `.execute()` method. Call it anywhere — a script, a test, a cron job, a serverless function:

```typescript
const rows = await revenue.execute()
// fully typed. same return type as the query definition.
```

No HTTP round-trip. No server running. The query executes against your ClickHouse connection directly. This is the same code path that runs when an HTTP request comes in — you're not testing a stub, you're executing the real thing.

## Context 2: HTTP endpoint

Pass the query object into `serve()`:

```typescript
const app = serve({
  queries: { revenue },
})

app.listen(3000)
```

That's it. `GET /revenue` is now a live HTTP endpoint, fully typed, with an OpenAPI spec generated automatically. The shape of the response matches what `query()` returns — because it's the same function.

Run `hypequery dev` locally to get the interactive OpenAPI docs alongside it.

## Context 3: with auth and tenancy

The `query()` API accepts runtime metadata. If your endpoint requires authentication or scopes access per tenant, declare it on the query object:

```typescript
export const revenue = query({
  requiresAuth: true,
  query: async ({ ctx }) => {
    return ctx.db
      .table("orders")
      .where("tenant_id", "=", ctx.tenantId)
      .select("total_revenue", "order_date")
      .execute()
  },
})
```

Auth enforcement, tenant isolation, and query logic all live in one place. Nothing to wire up separately in a middleware layer.

## What didn't change

The builder-first serve API from 0.1.x still works. If you're using `.input()`, `.output()`, or `.requireAuth()` as chained methods, none of that breaks. 0.2.0 adds a path — it doesn't remove one.

The CLI (`@hypequery/cli@1.1.0`) now scaffolds new projects using the `query({ ... }) + serve({ queries })` pattern by default, so new projects get the cleaner API out of the box. Existing projects continue working as-is.

## Why this matters

The core problem with analytics backends in TypeScript isn't writing the query. It's writing it once and having it behave consistently across contexts — inline, over HTTP, as a React hook.

The `query()` object is the unit of work in hypequery. Define the query once. The shape is inferred. The auth rules are attached. The HTTP layer is optional, not a requirement.

You write the query once.

## Getting started

```bash
npm install @hypequery/serve@0.2.0 @hypequery/cli@1.1.0
```

If you're starting fresh:

```bash
npx @hypequery/cli init
```

The scaffolded project uses the new pattern. You'll have a working HTTP endpoint with OpenAPI docs within a few minutes.

For existing projects: the 0.1.x API is unchanged. You can migrate individual queries to the new pattern incrementally — start with the ones you're also running inline.
