<p align="center">
  <img src="./website-next/public/logo.png" alt="hypequery logo" width="300" />
</p>

<p align="center">
  <h3 align="center">The type-safe analytics backend for ClickHouse</h3>
</p>

<h4 align="center">Define ClickHouse analytics once, then run them inline, over HTTP, in React, or from agents.</h4>

<p align="center">
  <a href="https://github.com/hypequery/hypequery/blob/main/LICENSE">
    <img alt="hypequery license: Apache-2.0" src="https://img.shields.io/badge/hypequery-license%20Apache%202.0-2ea44f?style=for-the-badge" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/cli">
    <img alt="npm @hypequery/cli" src="https://img.shields.io/npm/v/%40hypequery%2Fcli?style=for-the-badge&label=%40hypequery%2Fcli" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/clickhouse">
    <img alt="npm @hypequery/clickhouse" src="https://img.shields.io/npm/v/%40hypequery%2Fclickhouse?style=for-the-badge&label=%40hypequery%2Fclickhouse" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/datasets">
    <img alt="npm @hypequery/datasets" src="https://img.shields.io/npm/v/%40hypequery%2Fdatasets?style=for-the-badge&label=%40hypequery%2Fdatasets" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/serve">
    <img alt="npm @hypequery/serve" src="https://img.shields.io/npm/v/%40hypequery%2Fserve?style=for-the-badge&label=%40hypequery%2Fserve" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/react">
    <img alt="npm @hypequery/react" src="https://img.shields.io/npm/v/%40hypequery%2Freact?style=for-the-badge&label=%40hypequery%2Freact" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hypequery/clickhouse">
    <img src="./.github/assets/hypequery-clickhouse-downloads.png" alt="@hypequery/clickhouse npm downloads growth" width="920" />
  </a>
</p>

<p align="center">
  <a href="https://hypequery.com/docs">Docs</a> •
  <a href="https://hypequery.featurebase.app/roadmap">Roadmap</a> •
  <a href="https://github.com/hypequery/hypequery-examples">Examples</a>
</p>

## The problem

Querying ClickHouse from TypeScript with the official client means writing raw SQL strings, casting results to `any`, and maintaining hand-rolled types that drift from your real schema.

As analytics features grow, the business meaning drifts too. `revenue`, `active users`, tenant scope, and time grain rules get copied across dashboards, API handlers, jobs, and agent tools until the product has several answers to the same question:

```ts
// Raw @clickhouse/client — no types, no safety, breaks silently
const result = await client.query({
  query: `SELECT region, sum(total) as revenue
          FROM orders
          WHERE created_at >= '2026-01-01'
          GROUP BY region
          ORDER BY revenue DESC`,
  format: 'JSONEachRow',
});
const rows = await result.json(); // typed as any[]
//    ^^^^ schema drift, typos, and runtime errors are on you
```

## The solution

hypequery gives TypeScript teams two layers that work together:

- `@hypequery/clickhouse` generates TypeScript types from your live ClickHouse schema and gives you a fluent query builder where every table name, column, filter, and result is fully typed.
- `@hypequery/datasets` adds a code-first semantic layer so dimensions, measures, metrics, tenant rules, and time semantics are defined once and reused everywhere.

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({ /* connection */ });

const revenueByRegion = await db
  .table('orders')             // ✅ autocompletes your real tables
  .select(['region'])          // ✅ only valid columns for this table
  .where('created_at', 'gte', '2026-01-01') // ✅ type-checked operator + value
  .sum('total', 'revenue')     // ✅ typed aggregation
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
// revenueByRegion is fully typed — no casting, no surprises
```

When the calculation needs to be shared, promote it into a dataset:

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
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
  },
});

export const revenue = Orders.metric('revenue', {
  measure: 'revenue',
  label: 'Revenue',
});
```

If this saves you from hand-writing ClickHouse types, a ⭐ helps other TypeScript devs find it.

## Why hypequery

- Build on top of your real ClickHouse schema instead of hand-maintained query types
- Keep shared analytics meaning in TypeScript instead of YAML, raw SQL strings, or a separate BI server
- Reuse the same query definition across scripts, APIs, React apps, and agents
- Make tenant isolation and time semantics part of the model instead of per-query conventions
- Start local with the query builder, then add HTTP routes only when you need them
- Keep inputs, outputs, and SQL behavior explicit enough to test and reason about

## Packages

- `@hypequery/clickhouse`: typed ClickHouse query builder
- `@hypequery/datasets`: code-first semantic layer for dimensions, measures, metrics, tenant scope, and time grains
- `@hypequery/serve`: code-first runtime for query contracts, HTTP routes, docs, and adapters
- `@hypequery/react`: thin TanStack Query hooks for hypequery APIs
- `@hypequery/mcp`: MCP server for exposing governed analytics tools to agents
- `@hypequery/schema`: ClickHouse schema definitions, migrations, and dataset compatibility checks
- `@hypequery/cli`: scaffolding, schema generation, and local dev tooling

## Quick Start

```bash
npm install -D @hypequery/cli
npx hypequery init
```

That gives you the main path:

1. Generate schema types from ClickHouse
2. Write typed queries locally
3. Promote shared analytics concepts into datasets and metrics
4. Expose the queries, datasets, or metrics over HTTP when you need a shared contract

For the semantic layer directly:

```bash
npm install @hypequery/datasets @hypequery/clickhouse
```

## Add Contracts And HTTP When Needed

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './analytics/client.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const activeUsers = query({
  description: 'List active users by region',
  input: z.object({ region: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('users')
      .where('status', 'eq', 'active')
      .where('region', 'eq', input.region)
      .execute(),
});

export const api = serve({
  queries: { activeUsers },
});

api.route('/activeUsers', api.queries.activeUsers);
```

The same query can then be:

- executed directly with `api.execute(...)`
- exposed as an HTTP route
- consumed from React with `@hypequery/react`
- described for tools and agents

If you do not need `serve`, a standalone query can execute itself:

```ts
const activeUsers = query({
  input: z.object({ region: z.string() }),
  query: ({ input }) =>
    db
      .table('users')
      .where('status', 'eq', 'active')
      .where('region', 'eq', input.region)
      .execute(),
});

await activeUsers.execute({
  input: { region: 'EMEA' },
});
```

The same served execution API also works for datasets and semantic metrics:

```ts
import { initServe } from '@hypequery/serve';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    region: dimension.string(),
  },
  measures: {
    revenue: measure.sum('total'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const queryBuilder = createQueryBuilder({ url, username, password, database });

const { serve } = initServe({
  context: () => ({ db: queryBuilder }),  // ✅ Pass queryBuilder via context once
});

export const api = serve({
  metrics: { revenue },          // ✅ Auto-extracts queryBuilder from context
  datasets: { orders: Orders },
});

await api.execute('revenue', {
  input: { dimensions: ['region'] },
});

await api.execute('dataset:orders', {
  input: { dimensions: ['region'], measures: ['revenue'] },
});
```

Dataset endpoints accept validated dimensions, measures, filters, ordering, time grains, and runtime tenant context. Metric endpoints expose one named KPI with the dimensions and filters allowed by its dataset.

## CLI

```bash
# Scaffold analytics files and env vars
npx hypequery init

# Run the local dev server with docs
npx hypequery dev

# Regenerate schema types
npx hypequery generate
```

## Learn More

- [Quick start](https://hypequery.com/docs/quick-start)
- [Core concepts](https://hypequery.com/docs/core-concepts)
- [Datasets](https://hypequery.com/docs/datasets/overview)
- [Metrics](https://hypequery.com/docs/datasets/metrics)
- [Query building](https://hypequery.com/docs/query-building/basics)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)

## License

Apache-2.0. See [LICENSE](LICENSE).
