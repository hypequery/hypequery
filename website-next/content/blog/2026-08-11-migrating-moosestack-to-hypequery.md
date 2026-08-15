---
title: "Migrating from MooseStack to hypequery"
description: "MooseStack is end of life. This guide maps its typed ClickHouse query and API layer to hypequery while keeping schema, streaming, and workflow migrations separate."
seoTitle: "MooseStack to hypequery: ClickHouse Migration Guide"
seoDescription: "MooseStack has reached end of life. Inventory Moose OLAP, APIs, streaming, and workflows, then migrate typed ClickHouse analytics to hypequery in stages."
pubDate: 2026-08-11
heroImage: ""
slug: migrating-moosestack-to-hypequery
status: published
tags:
  - ClickHouse
  - TypeScript
  - MooseStack
  - Migration
---

MooseStack’s maintainers have announced that **MooseStack has reached end of life and is no longer actively maintained**. The repository is archived and read-only. Read the [official EOL statement on GitHub](https://github.com/514-labs/moosestack#readme).

If you run MooseStack today, the important first move is not swapping one npm package for another. Moose covered several jobs—ClickHouse schema, streaming, workflows, query APIs, and a development harness—while hypequery deliberately focuses on the application-facing analytics layer.

Use hypequery to replace typed ClickHouse queries, semantic metrics, APIs, React consumers, and MCP tools. Give DDL migrations, ingestion, and workflow orchestration an explicit home of their own.

## Map the responsibilities first

| MooseStack responsibility | Migration destination |
| --- | --- |
| ClickHouse tables, materialized views, and DDL | Your existing SQL migration system, ClickHouse tooling, or infrastructure workflow |
| Kafka/Redpanda ingestion | Keep the pipeline or move it independently |
| Temporal workflows | Keep Temporal or choose another scheduler independently |
| Typed read queries | `@hypequery/clickhouse` |
| Data models, dimensions, and metrics | `@hypequery/datasets` |
| Query APIs | `@hypequery/serve` |
| Frontend analytics | `@hypequery/react` |
| Agent access | `@hypequery/mcp` |

This separation prevents a query-layer migration from turning into an infrastructure rewrite.

## 1. Freeze the current physical schema

Before changing application code, capture what Moose actually created in ClickHouse:

- tables and engines;
- partition and ordering keys;
- materialized views and target tables;
- dictionaries and projections;
- ingestion topics and consumers;
- scheduled workflows;
- query and ingest endpoints still receiving traffic.

Move the DDL into the migration system that will own it after Moose. hypequery introspects ClickHouse; it does not push physical schema into the database.

## 2. Generate TypeScript types from live ClickHouse

```bash
npm install -D @hypequery/cli
npx hypequery generate
```

The generated schema reflects what ClickHouse currently returns over HTTP, including large integers as strings, `DateTime` values as strings, arrays, and nullable columns. This is the new physical source of truth for application queries.

Create the client beside the Moose code so both can run during migration:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

## 3. Port read queries one at a time

Start with read-only endpoints. Preserve their filters, grouping, ordering, limits, and response shape, then compare generated SQL and results against the existing endpoint.

```ts
const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .where('status', 'eq', 'completed')
  .sum('amount', 'revenue')
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
```

The builder supports ClickHouse-native `final()`, `limitBy()`, `PREWHERE`, array joins, CTEs, percentiles, `argMax`, and analytical statistics. Window functions use `selectExpr` inside the typed selection. Check the [current capability matrix](/docs/capabilities) instead of relying on older comparison posts.

## 4. Promote shared meaning into datasets

Once a query matches, extract the business fields and metrics that multiple endpoints use:

```ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    p95OrderValue: measure.percentile('amount', 0.95),
  },
});

export const revenue = Orders.metric('revenue', {
  measure: 'revenue',
});
```

Do not mirror every table mechanically. Publish the dimensions and measures your product should expose.

## 5. Preserve tenant isolation at the model boundary

If Moose queries applied an organisation or account filter, declare the physical tenant column with `tenantKey` and pass the authenticated tenant through trusted runtime context:

```ts
import { createDatasetClient } from '@hypequery/datasets';

const analytics = createDatasetClient({ queryBuilder: db });

await analytics.execute(
  revenue,
  { dimensions: ['region'] },
  { runtime: { tenant: session.accountId } },
);
```

An unscoped query against a tenant-keyed dataset is rejected. Do not accept the tenant ID as ordinary request or agent input.

## 6. Replace query endpoints

Expose migrated metrics and datasets through Serve:

```ts
const { serve } = initServe({
  context: () => ({ db }),
});

export const api = serve({
  queryBuilder: db,
  metrics: { revenue },
  datasets: { orders: Orders },
});
```

Mount the Node or Fetch adapter inside the application you already deploy. Run old and new routes in parallel, compare production-shaped requests, and move consumers endpoint by endpoint.

## 7. Move React and agent consumers

Generate a route manifest for typed React hooks:

```bash
npx hypequery generate:manifest analytics/api.ts \
  --output src/generated/hypequery-manifest.json
```

For agents, publish the same datasets through `@hypequery/mcp`. The agent gets dataset discovery and bounded metric queries rather than raw ClickHouse credentials.

## 8. Remove Moose only after the dependency audit

Before shutting down the Moose runtime, confirm that:

- no read or ingest endpoint still receives traffic;
- DDL changes have a new owner;
- streaming consumers run independently;
- Temporal or scheduled jobs have moved;
- deployment and environment secrets no longer depend on Moose;
- dashboards and agents use the new contracts;
- alerting covers the replacement services.

## The architectural change

MooseStack treated the analytical backend as one framework. The post-migration stack has a narrower boundary:

- ClickHouse remains the data engine;
- dedicated systems own ingestion, DDL, and workflows;
- hypequery owns the TypeScript query and semantic contract used by the product.

That smaller surface is easier to adopt incrementally and easier to replace later because it does not own the whole data plane.

Read the [MooseStack EOL comparison](/compare/hypequery-vs-moose), verify the [current hypequery capabilities](/docs/capabilities), then run the [quick start](/docs/quick-start) against one table before planning the full cutover.
