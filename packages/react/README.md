# @hypequery/react

React hooks for typed Hypequery HTTP endpoints, built on TanStack Query.

Use `@hypequery/react` with APIs created by `@hypequery/serve`. The hooks call generated routes and infer input/output types from the API type you pass in.

## Install

```bash
npm install @hypequery/react @tanstack/react-query
# or
pnpm add @hypequery/react @tanstack/react-query
```

## Quick Start

Given a serve API:

```ts
// server/api.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './db.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const weeklyRevenue = query({
  description: 'Weekly revenue',
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

export type AnalyticsApi = typeof api;
```

Create hooks on the client:

```tsx
// client/analytics-hooks.ts
import { createHooks } from '@hypequery/react';
import type { AnalyticsApi } from '../server/api.js';

export const { useQuery, useMutation } = createHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  api: {} as AnalyticsApi,
});
```

Use them inside a component:

```tsx
function RevenuePanel() {
  const revenue = useQuery('weeklyRevenue', {
    startDate: '2026-01-01',
  });

  if (revenue.isLoading) return <p>Loading...</p>;
  if (revenue.error) return <p>{revenue.error.message}</p>;

  return <pre>{JSON.stringify(revenue.data, null, 2)}</pre>;
}
```

## Dataset And Metric Hooks

`createAnalyticsHooks` adds convenience wrappers for semantic endpoint names. Metrics use their endpoint name directly. Dataset endpoints are addressed as `dataset:<name>` in the API type and exposed through `useDataset(name, ...)`.

```tsx
import { createAnalyticsHooks } from '@hypequery/react';
import type { AnalyticsApi } from '../server/api.js';

import { manifest } from '../server/api.js'; // serve api.manifest(), serialized

export const { useMetric, useDataset } = createAnalyticsHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  manifest,
  metrics: ['revenue', 'averageOrderValue'] as const,
});

function Dashboard() {
  const revenue = useMetric('revenue', {
    dimensions: ['country'],
    filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
    limit: 10,
  });

  const orders = useDataset('orders', {
    dimensions: ['status'],
    measures: ['revenue', 'orderCount'],
  });

  return (
    <pre>
      {JSON.stringify({ revenue: revenue.data, orders: orders.data }, null, 2)}
    </pre>
  );
}
```

## Route Configuration

Hooks need to know each endpoint's HTTP method and path. There are three ways to
supply that, in increasing precedence: a route manifest, a runtime `api` object,
or explicit `config`.

### Route manifest (recommended)

`@hypequery/serve`'s `api.manifest()` returns a serializable map of every
query/metric/dataset key to its `{ method, path }`. Export it from a server-only
module and pass it to the hooks — this avoids importing server code into the
browser bundle while keeping client routes in sync with the server.

```ts
// server side (server-only module)
export const manifest = api.manifest();

// client side
const { useQuery } = createHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  manifest,
});
```

> Metric and dataset endpoints are POST routes whose paths differ from their map
> keys (e.g. `dataset:orders` → `POST /api/analytics/datasets/orders/query`). They
> require a `manifest` (or explicit `config`); calling them without one throws a
> clear error rather than hitting the wrong URL.

### Explicit config

If a manifest is not available at runtime, pass route config explicitly. This
overrides any manifest entry.

```ts
const { useQuery } = createHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  config: {
    weeklyRevenue: { method: 'POST', path: '/weeklyRevenue' },
  },
});
```

`path` may be relative to `baseUrl`, absolute within the same origin, or an absolute HTTP URL.

## Headers

Pass static headers or a function that returns headers.

```ts
const hooks = createHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  headers: () => ({
    authorization: `Bearer ${localStorage.getItem('token')}`,
  }),
});
```

## Query Options

TanStack Query options can be passed as the final argument.

```tsx
const result = useQuery(
  'weeklyRevenue',
  { startDate: '2026-01-01' },
  {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  },
);
```

For no-input queries, use `queryOptions()` when an options object might look like input.

```tsx
import { queryOptions } from '@hypequery/react';

const result = useQuery('health', queryOptions({
  staleTime: 30_000,
}));
```

## Mutations

`useMutation(name)` uses the same endpoint typing and sends requests as `POST` by default unless route config overrides it.

```tsx
const refresh = useMutation('refreshReport');

refresh.mutate({ reportId: 'revenue' });
```

## Notes

- This package does not define datasets. Use `@hypequery/datasets` for semantic definitions.
- This package does not generate SQL. It calls HTTP routes exposed by `@hypequery/serve`.
- Dataset relationship JOIN execution is not implied by the React hooks; hooks consume whatever endpoint behavior the server exposes.

## License

Apache-2.0.
