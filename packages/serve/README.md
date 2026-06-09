# @hypequery/serve

Code-first runtime for turning hypequery queries into reusable contracts, direct execution helpers, and HTTP routes.

Use it when a local query should become something the rest of your app can call consistently.

## Install

```bash
npm install @hypequery/serve zod
```

`tsx` is an optional peer dependency used by the local dev workflow.

## Quick Start

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const weeklyRevenue = query({
  description: 'Calculate weekly revenue',
  input: z.object({ startDate: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('created_at', 'gte', input.startDate)
      .sum('total', 'revenue')
      .execute(),
});

export const api = serve({
  queries: { weeklyRevenue },
});

api.route('/weeklyRevenue', api.queries.weeklyRevenue);
```

Now you can:

- call `api.execute('weeklyRevenue', { input: ... })` in process
- expose the same query over HTTP
- consume it from `@hypequery/react`
- describe it for tools and agents

The same `api.execute(...)` call works for configured metrics and datasets:

```ts
import { initServe } from '@hypequery/serve';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const queryBuilder = createQueryBuilder({ url, username, password, database });

const { serve } = initServe({
  context: () => ({ db: queryBuilder }),  // ✅ Pass queryBuilder via context once
});

const api = serve({
  metrics: { revenue },          // ✅ Auto-extracts queryBuilder from context
  datasets: { orders: Orders },
});

await api.execute('revenue', {
  input: { dimensions: ['country'] },
});

await api.execute('dataset:orders', {
  input: { dimensions: ['country'], measures: ['revenue'] },
});
```

## Main Ideas

### `query({ ... })`

Defines a typed contract:

- description
- optional input schema
- query implementation

Standalone queries can execute without creating a served API:

```ts
const topCustomers = query({
  input: z.object({ limit: z.number().int().positive() }),
  query: async ({ input }) =>
    db
      .table('orders')
      .select(['customer_id'])
      .sum('total', 'revenue')
      .groupBy('customer_id')
      .limit(input.limit)
      .execute(),
});

await topCustomers.execute({
  input: { limit: 10 },
});
```

### `serve({ queries, metrics, datasets })`

Builds a runtime around those contracts:

- direct execution
- route registration
- docs and OpenAPI support
- hooks, auth, and tenancy features when needed

## Common Example

```ts
const topCustomers = query({
  description: 'Top customers by revenue',
  input: z.object({ limit: z.number().int().positive().default(10) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select(['customer_id'])
      .sum('total', 'revenue')
      .groupBy('customer_id')
      .orderBy('revenue', 'DESC')
      .limit(input.limit)
      .execute(),
});

export const api = serve({
  queries: { topCustomers },
});

api.route('/topCustomers', api.queries.topCustomers);
```

## Adapters And Runtimes

`@hypequery/serve` can be used behind different runtimes and adapters, but most users should start with the standard `initServe(...).serve(...)` path and the CLI dev server.

If you need framework-specific integration, see the docs for:

- Node handlers
- Fetch handlers
- OpenAPI generation
- auth and middleware

## Docs

- [Core concepts](https://hypequery.com/docs/core-concepts)
- [Serve runtime reference](https://hypequery.com/docs/reference/runtime)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)

## License

Apache-2.0.
