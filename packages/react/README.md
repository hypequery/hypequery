# @hypequery/react

Typed React hooks for ClickHouse analytics, powered by TanStack Query.

`@hypequery/react` carries `@hypequery/serve` contracts into React and Next.js. Query names, inputs, metrics, dataset fields, and response rows stay inferred from the server, so frontend analytics do not drift into a second set of hand-written types.

Use it for product dashboards, embedded analytics, customer reporting, and multi-tenant SaaS metrics.

## Install

```bash
npm install @hypequery/react @tanstack/react-query
```

## Create hooks from your API

Generate a small route manifest during the build:

```bash
npx hypequery generate:manifest analytics/api.ts \
  --output src/generated/hypequery-manifest.json
```

## Configure Once With `HypequeryProvider`

For hosted APIs and generated clients, create hooks without transport
configuration. A provider supplies one client to the application and includes a
TanStack Query provider by default.

```tsx
// client/hypequery.ts
import { createHooks } from '@hypequery/react';
import type { AnalyticsApi } from '../server/api.js';

export const { useQuery, useMutation } = createHooks<AnalyticsApi>();
```

```tsx
// app/providers.tsx
'use client';

import {
  createHypequeryClient,
  HypequeryProvider,
} from '@hypequery/react';
import type { ReactNode } from 'react';
import type { AnalyticsApi } from '../server/api.js';
import manifest from '../generated/hypequery-manifest.json';

const client = createHypequeryClient<AnalyticsApi>({
  baseUrl: 'https://acme.hypequery.cloud/v1/analytics/production',
  manifest,
  // Resolve a short-lived browser token. Never expose a server API key here.
  token: async () => tokenStore.get(),
  onUnauthorized: () => tokenStore.refresh(),
});

export function Providers({ children }: { children: ReactNode }) {
  return <HypequeryProvider client={client}>{children}</HypequeryProvider>;
}
```

Applications that already own a TanStack Query client can pass it through the
`queryClient` prop so Hypequery shares the existing cache.

Each client instance receives an isolated cache scope. Create a new client when
the deployment, tenant, or authenticated user changes. A deterministic
`cacheKey` may be supplied when the same security context must retain cache data
across equivalent client instances.

## Create Dataset And Metric Hooks

`createAnalyticsHooks` adds convenience wrappers for semantic endpoint names. Metrics use their endpoint name directly. Dataset endpoints are addressed as `dataset:<name>` in the API type and exposed through `useDataset(name, ...)`.

```tsx
import { createAnalyticsHooks } from '@hypequery/react';
import type { AnalyticsApi } from '../server/api.js';
import manifest from '../generated/hypequery-manifest.json';

export const { useMetric, useDataset } =
  createAnalyticsHooks<AnalyticsApi>({
    baseUrl: '/api/analytics',
    manifest,
    metrics: ['revenue'] as const,
  });
```

## Build the dashboard

```tsx
function RevenueByRegion() {
  const revenue = useMetric('revenue', {
    dimensions: ['region'],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
    limit: 10,
  });

  if (revenue.isLoading) return <p>Loading revenue…</p>;
  if (revenue.error) return <p>{revenue.error.message}</p>;

  return <RevenueChart rows={revenue.data?.data ?? []} />;
}
```

Change the server contract and TypeScript points to the components that need updating.

## Included

- named query hooks and mutations;
- metric and dataset hooks with selected-field inference;
- infinite queries with semantic pagination metadata;
- TanStack Query caching, retries, and refresh behavior;
- static route manifests that keep server code out of browser bundles;
- per-request auth headers and one-time `401` refresh.

## Why it matters

The ClickHouse query, semantic metric, HTTP schema, and React component share one contract. That means fewer casts, fewer mismatched route types, and no frontend rewrite when a dashboard graduates from a prototype into a governed multi-tenant product surface.

## Learn more

- [React quick start](https://hypequery.com/docs/react/getting-started)
- [Using queries](https://hypequery.com/docs/react/using-queries)
- [Advanced patterns](https://hypequery.com/docs/react/advanced-patterns)
- [Current capabilities](https://hypequery.com/docs/capabilities)

## License

Apache-2.0.
