---
title: "ClickHouse MCP: Give Your AI Agent Type-Safe Access to Analytics Data"
description: "A safer ClickHouse MCP pattern: expose a small set of named analytics queries as tools instead of letting the model write arbitrary SQL."
seoTitle: "ClickHouse MCP Server: Safer Agent Access Without Raw SQL"
seoDescription: "Build a ClickHouse MCP server around named analytics queries instead of raw SQL so tenant scope and response shapes stay under control."
pubDate: 2026-04-23
heroImage: ""
slug: clickhouse-mcp-typescript
status: published
---

The Model Context Protocol (MCP) is how AI agents get access to external tools. If you want an agent to query ClickHouse, the first real design decision is not how to connect it. It is what the agent should actually be allowed to do.

Most MCP plus ClickHouse examples do the same thing: open a database connection and let the model write arbitrary SQL. That may be fine for exploration. It is the wrong default for production.

The problems with arbitrary SQL over MCP: no tenant isolation (a model that can write any query can read any tenant's data), no type contract (the agent doesn't know what shape to expect back), no access control (every table is reachable), and no audit trail.

This post shows the safer alternative: define the queries first, then expose only those queries as MCP tools.

## How hypequery serve + MCP fits together

hypequery's `@hypequery/serve` package takes a set of typed query objects and exposes them as an HTTP API with an OpenAPI spec. That OpenAPI spec is machine-readable — exactly what you need to generate MCP tool definitions.

```
ClickHouse
    ↓
hypequery query objects (typed, tenant-isolated, auth-checked)
    ↓
@hypequery/serve → HTTP API + OpenAPI spec
    ↓
MCP server (reads OpenAPI, exposes as tools)
    ↓
AI agent (Claude, Cursor, custom)
```

The agent never touches ClickHouse directly. It calls tool functions that are backed by your pre-defined, type-safe query objects.

## Step 1: Define your queries

```typescript
import { initServe } from "@hypequery/serve"
import { db } from "./db"

const { query, serve } = initServe({
  context: (req) => ({
    db,
    tenantId: req.headers["x-tenant-id"] as string,
  }),
})

export const dailyRevenue = query({
  query: async ({ ctx }) => {
    return ctx.db
      .table("orders")
      .select("order_date", "total_revenue", "order_count")
      .where("tenant_id", "=", ctx.tenantId)
      .where("status", "=", "completed")
      .groupBy("order_date")
      .orderBy("order_date", "DESC")
      .limit(30)
      .execute()
  },
})

export const topProducts = query({
  query: async ({ ctx }) => {
    return ctx.db
      .table("order_items")
      .select("product_name", "total_sold", "revenue")
      .where("tenant_id", "=", ctx.tenantId)
      .groupBy("product_name")
      .orderBy("revenue", "DESC")
      .limit(10)
      .execute()
  },
})
```

These are typed query objects. They know their output shape. Tenant isolation is injected via context — the agent can't bypass it because it never sees the WHERE clause.

## Step 2: Expose as HTTP API

```typescript
const app = serve({
  queries: { dailyRevenue, topProducts },
})

app.listen(3000)
```

`GET /dailyRevenue` and `GET /topProducts` are now live. hypequery generates an OpenAPI spec at `/openapi.json`.

## Step 3: Generate MCP tools from the OpenAPI spec

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

const HYPEQUERY_BASE = "http://localhost:3000"

async function buildServer() {
  const spec = await fetch(`${HYPEQUERY_BASE}/openapi.json`).then(r => r.json())

  const server = new McpServer({
    name: "clickhouse-analytics",
    version: "1.0.0",
  })

  for (const [path, methods] of Object.entries(spec.paths)) {
    const get = (methods as any).get
    if (!get) continue

    const toolName = path.replace("/", "").replace(/\//g, "_")

    server.tool(toolName, get.description ?? `Query ${toolName}`, {}, async () => {
      const res = await fetch(`${HYPEQUERY_BASE}${path}`, {
        headers: { "x-tenant-id": process.env.TENANT_ID ?? "" },
      })
      const data = await res.json()
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      }
    })
  }

  return server
}

const server = await buildServer()
const transport = new StdioServerTransport()
await server.connect(transport)
```

The MCP server dynamically reads whatever queries hypequery exposes. Add a new query to `serve({ queries })` and it appears as a new tool automatically — no manual MCP registration.

## What the agent sees

With this setup, a Claude agent connected to this MCP server sees:

```
dailyRevenue() — Returns daily revenue totals for the last 30 days
topProducts()  — Returns top 10 products by revenue
```

It can call these tools and reason over the structured response. It cannot write arbitrary SQL. It cannot read tables you haven't defined queries for. It cannot see data from other tenants.

## Adding parameters

```typescript
export const revenueByDateRange = query({
  input: z.object({
    from: z.string(),
    to: z.string(),
  }),
  query: async ({ ctx, input }) => {
    return ctx.db
      .table("orders")
      .select("order_date", "total_revenue")
      .where("tenant_id", "=", ctx.tenantId)
      .where("order_date", ">=", input.from)
      .where("order_date", "<=", input.to)
      .groupBy("order_date")
      .execute()
  },
})
```

hypequery adds the input schema to the OpenAPI spec. The MCP server registers the tool with the correct parameter definitions. The agent can now call `revenueByDateRange({ from: "2026-01-01", to: "2026-01-31" })` with type-checked inputs.

## Why this matters

The naive "give the agent raw SQL access" approach has a short shelf life in any multi-tenant or production system. Pre-defined query objects give you access control, tenant isolation, predictable response shapes, and auditability.

The hypequery serve layer was designed for this: define queries once, expose them in multiple contexts. MCP is one more context.

## Getting started

```bash
npm install @hypequery/clickhouse @hypequery/serve
npm install @modelcontextprotocol/sdk
```
