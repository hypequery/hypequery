# @hypequery/serve

Turn TypeScript ClickHouse queries into trusted analytics APIs.

`@hypequery/serve` lets one query contract run inside your app, over HTTP, through OpenAPI, in typed React hooks, or as an agent tool. Inputs are validated, outputs stay typed, and authentication and tenant context live at the server boundary.

## Install

```bash
npm install @hypequery/serve zod
```

## Define once

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const weeklyRevenue = query({
  description: 'Weekly revenue since a given date',
  input: z.object({ startDate: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('created_at', 'gte', input.startDate)
      .sum('amount', 'revenue')
      .execute(),
});

export const api = serve({ queries: { weeklyRevenue } });
api.route('/weekly-revenue', api.queries.weeklyRevenue);
```

## Run anywhere

```ts
await api.execute('weeklyRevenue', {
  input: { startDate: '2026-01-01' },
});
```

The same contract can power a REST endpoint, generated OpenAPI, a typed `@hypequery/react` hook, or a tool description for an AI agent.

Serve also accepts semantic metrics and datasets directly:

```ts
export const api = serve({
  metrics: { revenue },
  datasets: { orders: Orders },
});
```

## Built for real analytics APIs

- zod input and output validation;
- authentication, roles, scopes, and explicit public routes;
- trusted multi-tenant context and automatic tenant predicates;
- OpenAPI and static React route manifests;
- CORS, rate limiting, request IDs, logging, and cache observability;
- Node and Fetch adapters for existing application stacks.

## Why it matters

Analytics endpoints usually drift across three copies: the SQL, the API type, and the frontend client. Serve keeps them on one TypeScript contract while leaving deployment and framework choices with your application.

## Learn more

- [Core concepts](https://hypequery.com/docs/core-concepts)
- [HTTP and OpenAPI](https://hypequery.com/docs/http-openapi)
- [Authentication](https://hypequery.com/docs/authentication)
- [Multi-tenancy](https://hypequery.com/docs/multi-tenancy)
- [Current capabilities](https://hypequery.com/docs/capabilities)

## License

Apache-2.0.
