# @hypequery/react

Type-safe React hooks for hypequery APIs. Wraps your generated API definition in thin TanStack Query shims so you can call `useQuery('weeklyRevenue')` with end-to-end type safety.

## Installation

```bash
npm install @hypequery/react @tanstack/react-query
```

Peer dependencies: `react@^18`, `@tanstack/react-query@^5`.

## Basic usage

```ts
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { Api } from '@/analytics/queries';

export const { useQuery, useMutation, HypequeryProvider } = createHooks<Api>({
  baseUrl: '/api',
});
```

Wrap your app:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HypequeryProvider } from '@/lib/analytics';

const queryClient = new QueryClient();

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HypequeryProvider>{children}</HypequeryProvider>
    </QueryClientProvider>
  );
}
```

Query:

```tsx
const { data, error, isLoading } = useQuery('weeklyRevenue', { startDate: '2025-01-01' });
```

Mutation:

```tsx
const rebuild = useMutation('rebuildMetrics');
rebuild.mutate({ force: true });
```

Options pass straight through to TanStack Query.
