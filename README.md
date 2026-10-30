# hypequery

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./website-next/public/logo-on-dark.png" />
    <img src="./website-next/public/logo.png" alt="hypequery, the analytics layer for ClickHouse" width="300" />
  </picture>
</p>

<p align="center"><strong>The analytics layer for ClickHouse.</strong></p>

Define your metrics once, in the codebase you already have. Dashboards, APIs, and AI agents all answer from that one definition. Run it in your own backend, or on hypequery cloud.

hypequery is open source, with SDKs for TypeScript and Python. Model datasets, dimensions, and measures in code, query them by name with tenant isolation built in, then serve them as authenticated HTTP endpoints, typed React hooks, and MCP tools for agents. There's no separate BI server and no YAML project.

<p align="center">
  <a href="https://hypequery.com/docs/quick-start">TypeScript quick start</a> ·
  <a href="https://hypequery.com/docs/python">Python quick start</a> ·
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

## Start in minutes (TypeScript)

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

## Python (beta)

The Python SDK implements the same datasets and Serve protocol, checked against the same conformance fixtures. Serve it from FastAPI, Django, Flask, or any ASGI or WSGI server.

```bash
pip install "hypequery[clickhouse]==0.1.0b1"
```

```python
from hypequery.datasets import Dataset, DatasetQuery, ExecutionContext, create_dataset_client, dimension, measure, tenant
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    dimensions={"country": dimension("string")},
    measures={"revenue": measure.sum("amount")},
)

analytics = create_dataset_client(executor=create_clickhouse_executor(ClickHouseConnection.from_env()))
result = analytics.execute(
    orders,
    DatasetQuery(dimensions=("country",), measures=("revenue",)),
    context=ExecutionContext(tenant=tenant("org_123")),
)
```

See the [Python docs](https://hypequery.com/docs/python) and [`python/hypequery`](./python/hypequery).

## Built for product analytics

- **ClickHouse-native:** generated types plus `FINAL`, `LIMIT BY`, percentiles, `argMax`, arrays, CTEs, streaming, and window expressions.
- **Governed in code:** dimensions, measures, metrics, relationships, and time grains live beside your application.
- **Multi-tenant by design:** runtime tenant scope fails closed instead of relying on every query author to remember a filter.
- **Frontend ready:** typed TanStack Query hooks for named queries, metrics, and datasets.
- **Agent ready:** MCP tools expose approved analytics, not unrestricted SQL.
- **Two languages, one contract:** TypeScript and Python produce the same semantic and deployment artifacts.
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
| [`hypequery`](./python/hypequery) (PyPI) | Python datasets, execution, Serve, and CLI (beta) |

## Explore

- [What hypequery supports today](https://hypequery.com/docs/capabilities)
- [ClickHouse semantic layer](https://hypequery.com/clickhouse-semantic-layer)
- [Multi-tenant analytics](https://hypequery.com/docs/datasets/multi-tenancy)
- [React hooks](https://hypequery.com/docs/react/getting-started)
- [MooseStack EOL comparison](https://hypequery.com/compare/hypequery-vs-moose)
- [MooseStack migration guide](https://hypequery.com/blog/migrating-moosestack-to-hypequery)

If hypequery saves you from another copied SQL string or drifting metric, a GitHub star helps the next team find it.

## License

Apache-2.0. See [LICENSE](./LICENSE).
