# hypequery

<p align="center">
  <img src="./website-next/public/logo.png" alt="hypequery TypeScript semantic layer for ClickHouse" width="300" />
</p>

<p align="center"><strong>The type-safe analytics backend for ClickHouse.</strong></p>

hypequery is an open-source TypeScript semantic layer and type-safe query builder for ClickHouse. Define analytics once, then use the same trusted contract in backend code, multi-tenant APIs, React hooks, and MCP tools for AI agents.

It fits the stack you already have. Generate types from your live ClickHouse schema, model metrics in normal TypeScript, and catch broken tables, columns, filters, and result shapes before production—without another BI server or YAML project.

<p align="center">
  <a href="https://hypequery.com/docs/quick-start">Quick start</a> ·
  <a href="https://hypequery.com/docs/capabilities">Capabilities</a> ·
  <a href="https://github.com/hypequery/hypequery-examples">Examples</a> ·
  <a href="https://hypequery.com/clickhouse-mcp">MCP</a>
</p>

## One definition, every surface

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

That dataset can run in a worker, become a validated HTTP endpoint, power a typed React dashboard, or appear as a bounded MCP tool. Tenant scope and metric meaning stay in one place.

## Start in minutes

```bash
npm install -D @hypequery/cli
npx hypequery init
npx hypequery dev
```

Or add only the ClickHouse query builder:

```bash
npm install @hypequery/clickhouse
```

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

No hand-written result interface. No `any[]`. The result is inferred from your real schema and the query itself.

## Built for product analytics

- **ClickHouse-native:** generated types plus `FINAL`, `LIMIT BY`, percentiles, `argMax`, arrays, CTEs, streaming, and window expressions.
- **Governed in code:** dimensions, measures, metrics, relationships, and time grains live beside your application.
- **Multi-tenant by design:** runtime tenant scope fails closed instead of relying on every query author to remember a filter.
- **Frontend ready:** typed TanStack Query hooks for named queries, metrics, and datasets.
- **Agent ready:** MCP tools expose approved analytics, not unrestricted SQL.
- **Easy to adopt:** start with one local query and add the semantic, HTTP, React, or MCP layers only when needed.

## Packages

| Package | Job |
| --- | --- |
| [`@hypequery/clickhouse`](./packages/clickhouse) | Type-safe ClickHouse query builder |
| [`@hypequery/datasets`](./packages/datasets) | TypeScript semantic layer |
| [`@hypequery/serve`](./packages/serve) | Validated analytics APIs and OpenAPI |
| [`@hypequery/react`](./packages/react) | Typed React hooks |
| [`@hypequery/mcp`](./packages/mcp-server) | Governed ClickHouse MCP server |
| [`@hypequery/cli`](./packages/cli) | Setup, generation, local docs, and deployment |

## Explore

- [What hypequery supports today](https://hypequery.com/docs/capabilities)
- [ClickHouse semantic layer](https://hypequery.com/clickhouse-semantic-layer)
- [Multi-tenant analytics](https://hypequery.com/docs/datasets/multi-tenancy)
- [React hooks](https://hypequery.com/docs/react/getting-started)
- [MooseStack EOL comparison](https://hypequery.com/compare/hypequery-vs-moose)
- [MooseStack migration guide](https://hypequery.com/blog/migrating-moosestack-to-hypequery)

If hypequery saves you from another copied SQL string or drifting metric, a GitHub star helps the next TypeScript team find it.

## License

Apache-2.0. See [LICENSE](./LICENSE).
