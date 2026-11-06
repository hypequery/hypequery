---
title: "ClickHouse MCP: Give Your AI Agent Type-Safe Access to Analytics Data"
description: "A safer ClickHouse MCP pattern: publish governed datasets and named metrics as MCP tools instead of letting the model write arbitrary SQL."
seoTitle: "ClickHouse MCP Server: Safer Agent Access Without Raw SQL"
seoDescription: "Expose ClickHouse to AI agents through @hypequery/mcp: published datasets and named metrics become validated MCP tools, with no raw SQL tool and tenant scope set by the server."
pubDate: 2026-04-23
updatedAt: 2026-11-05
heroImage: ""
slug: clickhouse-mcp-typescript
status: published
---

> **Updated November 2026.** The first version of this post built an MCP server by hand. It read `@hypequery/serve`'s OpenAPI spec and forwarded a tenant header from an environment variable. You no longer need to do that. `@hypequery/mcp` now exposes your published datasets and metrics as MCP tools directly, so this post walks through that path instead.

The Model Context Protocol (MCP) is how AI agents get access to external tools. If you want an agent to query ClickHouse, the first real design decision is not how to connect it. It is what the agent should actually be allowed to do.

Most MCP plus ClickHouse examples do the same thing: open a database connection and let the model write arbitrary SQL. That may be fine for exploration. It is the wrong default for production.

Arbitrary SQL over MCP causes four problems:

- **Tenant scope depends on the prompt.** A model that can write any query can leave out the `WHERE tenant_id = …` clause.
- **There is no contract.** The agent has to guess table names, column meanings and how a metric like "revenue" is calculated.
- **Every table is reachable.** Anything the database user can read, the agent can read.
- **Nothing bounds the cost.** One unbounded scan can return millions of rows into the model's context.

The safer alternative is to define the analytics vocabulary first, then expose only that vocabulary as MCP tools.

## How it fits together

```
ClickHouse
    ↓
@hypequery/clickhouse query builder (holds the credentials)
    ↓
@hypequery/datasets: datasets, measures and named metrics
    ↓
publishDatasets(): the registry agents are allowed to see
    ↓
@hypequery/mcp (hypequery-mcp): four semantic tools over stdio
    ↓
AI agent (Claude Desktop, Cursor, or any other MCP client)
```

The agent never sees SQL or credentials. It picks from the datasets, dimensions, measures and metrics you published, and `@hypequery/mcp` checks every call against that catalog before running it.

## Step 1: Define a dataset and its metrics

A dataset maps a ClickHouse table to dimensions (fields you can group and filter by) and measures (aggregations). Named metrics are stable KPIs built on those measures. Labels and descriptions matter here, because agents read them when they inspect the schema.

```typescript
// analytics/datasets.ts
import { dataset, dimension, measure } from "@hypequery/datasets"

export const Orders = dataset("orders", {
  source: "orders",
  timeKey: "created_at",
  dimensions: {
    region: dimension.string({ label: "Region" }),
    status: dimension.string({ label: "Order status" }),
    createdAt: dimension.timestamp({ column: "created_at", label: "Created at" }),
  },
  measures: {
    revenue: measure.sum("amount", {
      label: "Revenue",
      description: "Sum of order amounts.",
    }),
    orderCount: measure.count("id", { label: "Orders" }),
  },
})

export const revenue = Orders.metric("revenue", {
  measure: "revenue",
  label: "Revenue",
})

export const orderCount = Orders.metric("orderCount", {
  measure: "orderCount",
  label: "Order count",
})
```

The same definitions also back your `@hypequery/serve` endpoints, React hooks and backend jobs. An agent's "revenue" therefore matches the revenue on your dashboard.

## Step 2: Publish datasets for the MCP server

The MCP config file exports two things: a `datasets` registry and an `analytics` dataset client. The registry is the boundary. If a dataset is not published here, the server cannot list it, inspect it or query it.

```typescript
// mcp-config.ts
import { createQueryBuilder } from "@hypequery/clickhouse"
import { createDatasetClient, publishDatasets } from "@hypequery/datasets"
import { Orders, orderCount, revenue } from "./analytics/datasets.js"

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

export const datasets = publishDatasets()
  .publish(Orders, { metrics: { revenue, orderCount } })
  .build()

export const analytics = createDatasetClient({ queryBuilder: db })
```

`createDatasetClient({ queryBuilder })` is the same client the rest of your app uses to run dataset queries. The ClickHouse credentials stay inside this process.

## Step 3: Start the server

`hypequery-mcp` loads the config with a dynamic `import()`, so compile it to JavaScript first (with `tsc` or your normal build), then point the binary at the output:

```bash
npx hypequery-mcp --config /absolute/path/to/dist/mcp-config.js
```

The server speaks MCP over stdio, so in day-to-day use the MCP client starts it for you. It sends startup logs to stderr, because stdout carries the protocol messages.

## Step 4: Connect an MCP client

Add the server to Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS). Cursor accepts the same `command`, `args` and `env`:

```json
{
  "mcpServers": {
    "hypequery": {
      "command": "npx",
      "args": [
        "-y",
        "@hypequery/mcp",
        "--config",
        "/absolute/path/to/dist/mcp-config.js"
      ],
      "env": {
        "CLICKHOUSE_URL": "https://example.clickhouse.cloud:8443",
        "CLICKHOUSE_USERNAME": "default",
        "CLICKHOUSE_PASSWORD": "password",
        "CLICKHOUSE_DATABASE": "analytics"
      }
    }
  }
}
```

Use absolute paths. Desktop clients often start from a different working directory than your terminal. Restart the client after you change the config.

If your project already has a Serve API that registers datasets with `serve({ queryBuilder, datasets })`, you can skip the config file and run `npx hypequery mcp` from the project root instead. See the [MCP overview](/docs/mcp/overview) for both options and the [client setup guide](/docs/mcp/clients) for more clients.

## What the agent sees

The agent gets four tools. It does not get a SQL tool.

| Tool | What it does |
| --- | --- |
| `list_datasets` | Lists the published datasets, with descriptions and counts of dimensions, measures and metrics |
| `get_dataset_schema` | Returns one dataset's dimensions, measures, named metrics, filters, time grains and limits, with your labels and descriptions |
| `query_metric` | Runs a named metric such as `revenue`, optionally grouped, filtered and bucketed by a time grain |
| `query_dataset` | Runs an ad hoc query over the dimensions and measures you published |

The tool schemas are generated from your catalog, so they are not free-form strings. In the `orders` example above, `query_dataset` advertises `dimensions` as an array whose items must be one of `region`, `status` or `createdAt`, and `measures` as an array of `revenue` or `orderCount`. Unknown fields are rejected before anything reaches ClickHouse. The schemas also have no tenant argument (more on that below).

When someone asks "What was revenue by region last month?", a typical agent lists the datasets, reads the `orders` schema, and then makes one call:

```json
{
  "name": "query_metric",
  "arguments": {
    "dataset": "orders",
    "metric": "revenue",
    "dimensions": ["region"],
    "filters": [
      { "field": "createdAt", "operator": "gte", "value": "2026-10-01" },
      { "field": "createdAt", "operator": "lt", "value": "2026-11-01" }
    ],
    "orderBy": [{ "field": "revenue", "direction": "desc" }],
    "limit": 10
  }
}
```

Each result comes back twice: as MCP `structuredContent` for clients that support typed results, and as compact JSON text for clients that don't. Every query also gets a server-side row limit, even when the agent leaves it out. The default is 100 rows and the offset is capped at 10,000. A failed call returns a stable error code such as `MCP_INVALID_ARGUMENTS`, so the agent can correct itself. Database errors and the generated SQL are not copied into what the agent sees. See [MCP tools](/docs/mcp/tools) for every argument and error code.

## Multi-tenant data

If your ClickHouse tables hold several customers' data, declare a `tenantKey` on the dataset:

```typescript
// analytics/datasets.ts
import { dataset, dimension, measure } from "@hypequery/datasets"

export const Orders = dataset("orders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",
  dimensions: {
    region: dimension.string({ label: "Region" }),
    status: dimension.string({ label: "Order status" }),
    createdAt: dimension.timestamp({ column: "created_at", label: "Created at" }),
  },
  measures: {
    revenue: measure.sum("amount", { label: "Revenue" }),
    orderCount: measure.count("id", { label: "Orders" }),
  },
})

export const revenue = Orders.metric("revenue", { measure: "revenue" })
```

A tenant-scoped dataset refuses to run without a trusted tenant, and the MCP server refuses to start without one. The tenant is never a tool argument. You pin one tenant per server process in trusted configuration, and the server passes it to every `query_dataset` and `query_metric` call. Nothing the agent sends, and nothing in the chat, can change it.

The standalone `hypequery-mcp --config` binary has no tenant option, so it cannot serve tenant-scoped datasets. Start the server from your own entry point with `createMCPServer` instead:

```typescript
// mcp-server.ts
import { createQueryBuilder } from "@hypequery/clickhouse"
import { createDatasetClient, publishDatasets } from "@hypequery/datasets"
import { createMCPServer } from "@hypequery/mcp"
import { Orders, revenue } from "./analytics/datasets.js"

const tenantId = process.env.HYPEQUERY_TENANT_ID
if (!tenantId) {
  throw new Error("Set HYPEQUERY_TENANT_ID to the tenant this server may query.")
}

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

await createMCPServer({
  datasets: publishDatasets().publish(Orders, { metrics: { revenue } }).build(),
  analytics: createDatasetClient({ queryBuilder: db }),
  name: "acme-analytics",
  version: "1.0.0",
  tenantId,
})
```

Here the tenant comes from the environment that the MCP client config sets for this one process. If you use the CLI with a Serve API, run `npx hypequery mcp --tenant acme` instead.

MCP is a capability boundary, not an authentication layer. The stdio server trusts whoever launches it, so treat an MCP client as a powerful local operator. Don't share one server process across tenants. Read [MCP safety](/docs/mcp/safety) before you expose tenant data.

## Adding fields and metrics

You don't register tools by hand. To give the agent something new, change the dataset and republish it. This example extends the Step 1 dataset with a `channel` dimension and an average-order-value metric. If your dataset is tenant-scoped, keep its `tenantKey`: removing it removes the tenant filter, even when the server still has a `tenantId`.

```typescript
// analytics/datasets.ts
import { dataset, dimension, measure } from "@hypequery/datasets"

export const Orders = dataset("orders", {
  source: "orders",
  // Keep tenantKey: "tenant_id" here if your dataset is tenant-scoped.
  timeKey: "created_at",
  dimensions: {
    region: dimension.string({ label: "Region" }),
    status: dimension.string({ label: "Order status" }),
    channel: dimension.string({ label: "Sales channel" }),
    createdAt: dimension.timestamp({ column: "created_at", label: "Created at" }),
  },
  measures: {
    revenue: measure.sum("amount", { label: "Revenue" }),
    orderCount: measure.count("id", { label: "Orders" }),
    avgOrderValue: measure.avg("amount", { label: "Average order value" }),
  },
})

export const revenue = Orders.metric("revenue", { measure: "revenue" })
export const orderCount = Orders.metric("orderCount", { measure: "orderCount" })
export const averageOrderValue = Orders.metric("averageOrderValue", {
  measure: "avgOrderValue",
  label: "Average order value",
})
```

Add `averageOrderValue` to the `metrics` passed to `publish()`, rebuild the config and restart the server. `channel` then appears in the allowed dimensions, and `averageOrderValue` in the allowed metrics. An agent can ask for average order value by channel per month:

```json
{
  "name": "query_metric",
  "arguments": {
    "dataset": "orders",
    "metric": "averageOrderValue",
    "dimensions": ["channel"],
    "grain": "month"
  }
}
```

Filters, ordering, time grains and limits are checked against the field types and the dataset's own limits. The agent gets new capabilities only when you publish them.

## Why this matters

Giving the agent raw SQL doesn't last long in a multi-tenant or production system. Publishing datasets and named metrics gives you:

- a fixed set of datasets and fields the agent can reach;
- metric definitions shared with the rest of your application;
- arguments validated against a schema, with bounded result sizes;
- tenant scope set by the server, not by the prompt;
- credentials and generated SQL kept inside the server process.

It does not replace authentication or per-user authorization in front of the server, and the open-source server has no built-in audit log. If you need those, put them in the process that launches the server, or in your own transport around it (`createMCPExecutor` and `createMCPProtocolServer` let you embed the same tools in another transport).

If your analytics are served by a Python or other HTTP backend, `createMCPHttpExecutor` bridges that backend's authorized client contract. It exposes the same four tools, and the backend keeps control of SQL, authentication and tenancy. A hosted MCP endpoint on hypequery Cloud is in early access; you can [join the waitlist](/docs/cloud/mcp).

## Getting started

```bash
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
npm install -D typescript
```

Then:

1. Define a dataset and its metrics.
2. Export `datasets` (from `publishDatasets()`) and `analytics` (from `createDatasetClient({ queryBuilder })`) from a config file.
3. Compile the config and run `npx hypequery-mcp --config /absolute/path/to/dist/mcp-config.js`.
4. Add the same command to your MCP client's config.

Next, read the [MCP overview](/docs/mcp/overview), [configuration](/docs/mcp/configuration), [tools](/docs/mcp/tools) and [safety model](/docs/mcp/safety).
