# @hypequery/react

Typed React hooks for hypequery APIs.

`@hypequery/react` wraps a hypequery API definition in thin TanStack Query hooks, so `useQuery('weeklyRevenue')` and `useMutation('rebuildMetrics')` stay fully typed.

## Install

```bash
npm install @hypequery/react @tanstack/react-query
```

Peer dependencies:

- `react`
- `react-dom`
- `@tanstack/react-query`

## Quick Start

Create hooks from your API type:

```ts
import { createHooks } from '@hypequery/react';
import type { ApiDefinition } from '@/analytics/queries';

export const { useQuery, useMutation } = createHooks<ApiDefinition>({
  baseUrl: '/api/analytics',
});
```

Wrap your app with TanStack Query:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export function App({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

Use the hooks:

```tsx
const revenue = useQuery('weeklyRevenue', { startDate: '2026-01-01' });

const rebuild = useMutation('rebuildMetrics');
rebuild.mutate({ force: true });
```

## What You Get

- typed query inputs and outputs
- typed mutation inputs and outputs
- a small wrapper over TanStack Query instead of a separate client runtime
- support for custom headers, custom `fetch`, and per-route method overrides

## Common Config

```ts
const hooks = createHooks<ApiDefinition>({
  baseUrl: '/api/analytics',
  headers: () => ({
    Authorization: `Bearer ${token}`,
  }),
  config: {
    exportCsv: { method: 'POST' },
  },
});
```

## Error Handling

Failed HTTP requests throw `HttpError`, which includes:

- `message`
- `status`
- `body`

```tsx
import { HttpError } from '@hypequery/react';

const { error } = useQuery('userProfile', { id: '123' });

if (error instanceof HttpError && error.status === 404) {
  return <div>User not found</div>;
}
```

## Docs

- [React getting started](https://hypequery.com/docs/react/getting-started)
- [React API reference](https://hypequery.com/docs/reference/api/react)
- [Core concepts](https://hypequery.com/docs/core-concepts)

## License

Apache-2.0.
