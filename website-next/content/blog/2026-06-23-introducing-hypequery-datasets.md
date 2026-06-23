---
title: "Introducing hypequery Datasets: A Semantic Layer for ClickHouse in TypeScript"
description: "Define dimensions, measures, and metrics once in TypeScript, then reuse them across application code, HTTP APIs, dashboards, jobs, and AI agents."
seoTitle: "Introducing hypequery Datasets for ClickHouse and TypeScript"
seoDescription: "hypequery Datasets is a code-first semantic layer for ClickHouse. Define typed dimensions, measures, metrics, tenant scope, and time semantics once, then reuse them everywhere."
pubDate: 2026-06-23
heroImage: ""
slug: introducing-hypequery-datasets
status: published
tags:
  - ClickHouse
  - TypeScript
  - Semantic layer
  - Product analytics
---

Today we are launching **hypequery Datasets**, a semantic layer for ClickHouse written in TypeScript.

Datasets give the business meaning in your analytics system a home in your application code. You define the dimensions people can group by, the measures they can aggregate, the metrics the product depends on, and the tenant and time rules that every query must follow. The same definition can then power server code, background jobs, HTTP APIs, dashboards, and AI agents.

It is available now as `@hypequery/datasets`.

```bash
npm install @hypequery/datasets @hypequery/clickhouse
```

## The problem: query logic spreads

A typed query builder makes an individual query safer. It does not, by itself, decide what `revenue` means across an entire product.

As an analytics feature grows, its logic tends to spread across API handlers, dashboard endpoints, scheduled jobs, and one-off internal tools. Each consumer knows a little too much about the physical schema. The same aggregation is rewritten several times. A tenant predicate is present in four places and missing in the fifth. One endpoint groups by `created_at`, another uses `paid_at`, and both call the result monthly revenue.

The database may be fast and every query may be valid, but the product no longer has one answer to a basic question.

A semantic layer fixes that by putting a stable contract between physical tables and their consumers. Existing semantic-layer products often introduce a separate server, configuration language, or deployment surface. That can be the right choice for a central data platform. It is often a poor fit for a TypeScript team building ClickHouse-backed product features.

Datasets keep that contract in the codebase where the product is built.

## Define a dataset once

A dataset maps a ClickHouse table or view to typed dimensions and measures. It can also declare the physical tenant and time columns used by the runtime.

```typescript
// analytics/datasets/orders.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});
```

The physical table remains ClickHouse. Datasets do not copy data or introduce a second query engine. They define the allowed semantic surface and plan queries that `@hypequery/clickhouse` executes.

Connect that definition to the same typed query builder used elsewhere in your application:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export const analytics = createDatasetClient({ queryBuilder: db });
```

Now callers select semantic fields instead of rebuilding the aggregation:

```typescript
import { eq } from '@hypequery/datasets';
import { analytics } from '../client.js';
import { Orders } from './orders.js';

const result = await analytics.execute(Orders, {
  dimensions: ['country'],
  measures: ['revenue', 'orderCount'],
  filters: [eq('status', 'completed')],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  limit: 10,
});
```

Dimensions, measures, filters, and ordering fields are checked against the dataset definition. Invalid requests are rejected before SQL execution, and `analytics.toSQL(...)` is available when you want to inspect the generated ClickHouse query.

## Name the metrics that matter

Measures describe aggregations available on a dataset. Metrics give important calculations stable names.

```typescript
import { divide, nullIfZero } from '@hypequery/datasets';
import { Orders } from './orders.js';

export const revenue = Orders.metric('revenue', {
  measure: 'revenue',
  label: 'Revenue',
});

export const orderCount = Orders.metric('orderCount', {
  measure: 'orderCount',
  label: 'Order count',
});

export const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});
```

Derived metrics compose base metrics from the same dataset using symbolic formula helpers. This keeps the definition inspectable and prevents a reusable KPI from turning into an arbitrary callback with hidden behavior.

The payoff is not fewer lines in one query. It is one reviewed definition of average order value that every consumer shares.

## Tenant scope is part of the model

Multi-tenant analytics fails when tenant isolation is treated as a convention for every query author to remember.

When a dataset declares `tenantKey`, execution is fail-closed. The caller must provide trusted tenant context:

```typescript
const result = await analytics.execute(revenue, {
  dimensions: ['country'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});
```

The runtime injects the predicate on `tenant_id`. If tenant context is missing, execution stops before the query reaches ClickHouse. Explicit caller-provided filters on the tenant field are rejected while runtime tenancy is active, so untrusted input cannot replace the trusted scope.

Trusted internal jobs can opt into a known set of tenants or an explicit cross-tenant scope. Request-facing APIs and agent tools stay constrained to the tenant identity supplied by their host runtime.

## Use the same definitions over HTTP

Datasets work in-process without a server. When the definitions need an HTTP boundary, `@hypequery/serve` turns them into governed endpoints with validation, OpenAPI, documentation, auth, caching, and limits.

```typescript
import { initServe } from '@hypequery/serve';
import { db } from './client.js';
import { Orders } from './datasets/orders.js';
import { revenue } from './metrics.js';

const { serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

export const api = serve({
  queryBuilder: db,
  datasets: { orders: Orders },
  metrics: { revenue },
});
```

This generates two different kinds of contract:

- `POST /api/analytics/datasets/orders/query` supports flexible, same-dataset selections of dimensions and measures.
- `POST /api/analytics/metrics/revenue` exposes one named KPI with its valid dimensions, filters, ordering, and time grains.

The generated OpenAPI document describes the same constrained surface. React clients and MCP tools can consume it without gaining raw SQL access or bypassing the dataset definition.

## What is included today

The first release includes:

- typed dataset definitions over ClickHouse tables and views
- string, number, boolean, and timestamp dimensions
- sum, count, count-distinct, average, minimum, and maximum measures
- filtered measures and validated semantic filters
- named base metrics and same-dataset derived metrics
- day, week, month, quarter, and year time grains
- fail-closed tenant context with trusted multi-tenant and cross-tenant modes
- direct execution and SQL inspection through a dataset client
- generated dataset and metric endpoints through `@hypequery/serve`
- schema introspection and governed query tools for MCP consumers

There are deliberate boundaries. Datasets are not a data transformation framework, a BI tool, or a replacement for ClickHouse materialized views. Cross-dataset derived metrics and derived-from-derived metrics are not part of the current public surface. The goal is a small, explicit semantic contract for application analytics, with escape hatches into the normal query builder when a use case is genuinely bespoke.

## Start with one table

You do not need to model the warehouse. Start with the ClickHouse table behind one real product surface. Define its dimensions and measures, promote the calculations that are already reused into metrics, and move one API or dashboard onto the dataset client.

The quickest path is the [Datasets quick start](/docs/quick-start#route-2-datasets). The full model is covered in the [Datasets documentation](/docs/datasets/overview), including [metrics](/docs/datasets/metrics), [multi-tenancy](/docs/datasets/multi-tenancy), and [Serve integration](/docs/datasets/serve-integration).

Datasets are available now. Define the meaning once, then make every consumer use it.
