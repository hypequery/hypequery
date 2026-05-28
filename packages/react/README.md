# @hypequery/react

Type-safe React hooks for ClickHouse analytics with seamless TanStack Query integration, automatic query generation, and full TypeScript inference.

[![npm version](https://img.shields.io/npm/v/@hypequery/react.svg)](https://www.npmjs.com/package/@hypequery/react)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Features

- **Type-Safe Hooks** - Full TypeScript inference for datasets, dimensions, and measures
- **TanStack Query Integration** - Built on React Query for caching, refetching, and state management
- **Automatic Query Generation** - Generate ClickHouse SQL from simple field selections
- **Dataset Hooks** - Pre-configured hooks for each dataset with full type safety
- **Metric Hooks** - Reusable hooks for business metrics
- **Mutation Support** - Type-safe mutations for data modifications
- **Optimistic Updates** - Built-in support for optimistic UI updates
- **Request Deduplication** - Automatic deduplication of identical queries
- **SSR Compatible** - Works with Next.js and other SSR frameworks

## Installation

```bash
npm install @hypequery/react @tanstack/react-query
# or
pnpm add @hypequery/react @tanstack/react-query
```

## Quick Start

### 1. Set Up Datasets Registry

```typescript
// src/datasets/index.ts
import { createDatasetRegistry } from '@hypequery/datasets';
import { defineDataset, dimension, measure } from '@hypequery/datasets';

export const ordersDataset = defineDataset({
  name: 'orders',
  table: 'orders',
  dimensions: {
    orderId: dimension.number('id'),
    userId: dimension.number('user_id'),
    amount: dimension.number('amount'),
    status: dimension.string('status'),
    createdAt: dimension.time('created_at'),
  },
  measures: {
    totalRevenue: measure.sum('amount'),
    totalOrders: measure.count(),
    averageOrderValue: measure.avg('amount'),
  },
});

export const usersDataset = defineDataset({
  name: 'users',
  table: 'users',
  dimensions: {
    userId: dimension.number('id'),
    email: dimension.string('email'),
    name: dimension.string('name'),
    status: dimension.string('status'),
  },
  measures: {
    totalUsers: measure.count(),
    activeUsers: measure.countDistinct('id', {
      filter: "status = 'active'",
    }),
  },
});

export const registry = createDatasetRegistry({
  orders: ordersDataset,
  users: usersDataset,
});

export type Registry = typeof registry;
```

### 2. Create Analytics Hooks

```typescript
// src/hooks/analytics.ts
import { createAnalyticsHooks } from '@hypequery/react';
import type { Registry } from '../datasets/index.js';

// Client-side executor
async function executeQuery(query: { sql: string; parameters?: any }) {
  const response = await fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    throw new Error('Query execution failed');
  }

  return response.json();
}

export const {
  useDataset,
  useMetric,
  HypequeryProvider,
} = createAnalyticsHooks<Registry>({
  executor: executeQuery,
});
```

### 3. Set Up Provider

```typescript
// src/app/layout.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HypequeryProvider } from './hooks/analytics';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HypequeryProvider>
        {children}
      </HypequeryProvider>
    </QueryClientProvider>
  );
}
```

### 4. Use Hooks in Components

```typescript
// src/components/OrdersChart.tsx
'use client';

import { useDataset } from '../hooks/analytics';
import { registry } from '../datasets';

export function OrdersChart() {
  const { data, isLoading, error } = useDataset({
    dataset: registry.datasets.orders,
    fields: [
      'orders.createdAt',
      'orders.totalRevenue',
      'orders.totalOrders',
    ],
    dimensions: ['orders.createdAt'],
    granularity: 'day',
    dateRange: {
      start: '2024-01-01',
      end: '2024-12-31',
    },
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data?.rows.map((row) => (
        <div key={row['orders.createdAt']}>
          {row['orders.createdAt']}: ${row['orders.totalRevenue']}
        </div>
      ))}
    </div>
  );
}
```

## Core API

### `useDataset(options)`

Primary hook for querying datasets with full type safety.

```typescript
const result = useDataset({
  dataset: registry.datasets.orders,
  fields: ['orders.totalRevenue', 'orders.totalOrders'],
  dimensions: ['orders.createdAt'],
  granularity: 'month',
  filters: {
    'orders.status': { equals: 'completed' },
  },
  orderBy: [
    { field: 'orders.createdAt', direction: 'desc' },
  ],
  limit: 100,
  enabled: true, // TanStack Query option
  refetchInterval: 30000, // Refetch every 30 seconds
});
```

**Options:**
- `dataset`: Dataset definition from registry (required)
- `fields`: Array of field references (required)
- `dimensions?`: Array of dimensions for GROUP BY
- `granularity?`: Time granularity (`'day'`, `'week'`, `'month'`, `'quarter'`, `'year'`)
- `filters?`: Record of filter conditions
- `dateRange?`: `{ start: string, end: string }`
- `orderBy?`: Array of sort specifications
- `limit?`: Maximum rows to return
- `offset?`: Number of rows to skip
- `enabled?`: Enable/disable query execution (React Query option)
- `refetchInterval?`: Auto-refetch interval in milliseconds
- ...all other TanStack Query options

**Returns:**
```typescript
{
  data: QueryResult<T> | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<QueryResult<T>>;
  // ...all TanStack Query result properties
}
```

### `useMetric(metric, options)`

Hook for predefined business metrics.

```typescript
import { defineMetric } from '@hypequery/datasets';
import { useMetric } from './hooks/analytics';

const monthlyRecurringRevenue = defineMetric({
  name: 'Monthly Recurring Revenue',
  dataset: subscriptionsDataset,
  measure: 'subscriptions.totalMRR',
  filters: {
    'subscriptions.status': { equals: 'active' },
  },
});

function MRRWidget() {
  const { data, isLoading } = useMetric(monthlyRecurringRevenue, {
    dimensions: ['subscriptions.createdAt'],
    granularity: 'month',
  });

  return <div>MRR: ${data?.rows[0]?.value}</div>;
}
```

### `useMutation(options)`

Hook for data mutations with optimistic updates.

```typescript
import { useMutation } from './hooks/analytics';

function UpdateOrderStatus() {
  const mutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number; status: string }) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate orders queries
      queryClient.invalidateQueries({ queryKey: ['dataset', 'orders'] });
    },
  });

  return (
    <button onClick={() => mutation.mutate({ orderId: 123, status: 'shipped' })}>
      Ship Order
    </button>
  );
}
```

## Advanced Usage

### Query with Relationships

```typescript
function UserOrderStats() {
  const { data } = useDataset({
    dataset: registry.datasets.orders,
    fields: [
      'orders.user.email',      // Automatic JOIN
      'orders.user.name',
      'orders.totalRevenue',
      'orders.totalOrders',
    ],
    dimensions: ['orders.user.email', 'orders.user.name'],
    orderBy: [
      { field: 'orders.totalRevenue', direction: 'desc' },
    ],
    limit: 10,
  });

  return (
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Revenue</th>
          <th>Orders</th>
        </tr>
      </thead>
      <tbody>
        {data?.rows.map((row) => (
          <tr key={row['orders.user.email']}>
            <td>{row['orders.user.name']}</td>
            <td>{row['orders.user.email']}</td>
            <td>${row['orders.totalRevenue']}</td>
            <td>{row['orders.totalOrders']}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Dependent Queries

```typescript
function OrderDetails({ orderId }: { orderId: number }) {
  // First query: get order details
  const orderQuery = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.userId', 'orders.amount', 'orders.status'],
    filters: {
      'orders.orderId': { equals: orderId },
    },
  });

  // Second query: get user details (depends on first query)
  const userQuery = useDataset({
    dataset: registry.datasets.users,
    fields: ['users.name', 'users.email'],
    filters: {
      'users.userId': { equals: orderQuery.data?.rows[0]?.['orders.userId'] },
    },
    enabled: !!orderQuery.data?.rows[0]?.['orders.userId'], // Only run when userId available
  });

  if (orderQuery.isLoading) return <div>Loading order...</div>;
  if (userQuery.isLoading) return <div>Loading user...</div>;

  return (
    <div>
      <h2>Order #{orderId}</h2>
      <p>Customer: {userQuery.data?.rows[0]?.['users.name']}</p>
      <p>Amount: ${orderQuery.data?.rows[0]?.['orders.amount']}</p>
    </div>
  );
}
```

### Dynamic Filters

```typescript
function FilterableOrders() {
  const [status, setStatus] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<number>(0);

  const { data } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue', 'orders.totalOrders'],
    filters: {
      ...(status !== 'all' && {
        'orders.status': { equals: status },
      }),
      ...(minAmount > 0 && {
        'orders.amount': { greaterThanOrEqual: minAmount },
      }),
    },
  });

  return (
    <div>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="all">All</option>
        <option value="completed">Completed</option>
        <option value="pending">Pending</option>
      </select>

      <input
        type="number"
        value={minAmount}
        onChange={(e) => setMinAmount(Number(e.target.value))}
        placeholder="Min amount"
      />

      <div>Revenue: ${data?.rows[0]?.['orders.totalRevenue']}</div>
    </div>
  );
}
```

### Pagination

```typescript
function PaginatedOrders() {
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const { data, isLoading } = useDataset({
    dataset: registry.datasets.orders,
    fields: [
      'orders.orderId',
      'orders.amount',
      'orders.status',
      'orders.createdAt',
    ],
    dimensions: ['orders.orderId', 'orders.amount', 'orders.status', 'orders.createdAt'],
    orderBy: [
      { field: 'orders.createdAt', direction: 'desc' },
    ],
    limit: pageSize,
    offset: page * pageSize,
  });

  return (
    <div>
      <table>
        {/* Render orders */}
      </table>

      <button
        onClick={() => setPage((p) => Math.max(0, p - 1))}
        disabled={page === 0}
      >
        Previous
      </button>

      <span>Page {page + 1}</span>

      <button
        onClick={() => setPage((p) => p + 1)}
        disabled={!data?.rows.length || data.rows.length < pageSize}
      >
        Next
      </button>
    </div>
  );
}
```

### Real-Time Dashboard

```typescript
function RealtimeDashboard() {
  const { data: todayRevenue } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue'],
    filters: {
      'orders.createdAt': {
        greaterThanOrEqual: new Date().toISOString().split('T')[0],
      },
    },
    refetchInterval: 5000, // Refetch every 5 seconds
  });

  const { data: last24Hours } = useDataset({
    dataset: registry.datasets.orders,
    fields: [
      'orders.createdAt',
      'orders.totalRevenue',
      'orders.totalOrders',
    ],
    dimensions: ['orders.createdAt'],
    granularity: 'hour',
    dateRange: {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    refetchInterval: 60000, // Refetch every minute
  });

  return (
    <div>
      <h1>Today's Revenue: ${todayRevenue?.rows[0]?.['orders.totalRevenue']}</h1>
      <LineChart data={last24Hours?.rows} />
    </div>
  );
}
```

### Optimistic Updates

```typescript
function OrderActions({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    onMutate: async (newStatus) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['dataset', 'orders'] });

      // Snapshot previous value
      const previousOrders = queryClient.getQueryData(['dataset', 'orders']);

      // Optimistically update
      queryClient.setQueryData(['dataset', 'orders'], (old: any) => {
        return {
          ...old,
          rows: old.rows.map((row: any) =>
            row['orders.orderId'] === orderId
              ? { ...row, 'orders.status': newStatus }
              : row
          ),
        };
      });

      return { previousOrders };
    },
    onError: (err, newStatus, context) => {
      // Rollback on error
      queryClient.setQueryData(['dataset', 'orders'], context?.previousOrders);
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: ['dataset', 'orders'] });
    },
  });

  return (
    <button onClick={() => updateStatus.mutate('shipped')}>
      Ship Order
    </button>
  );
}
```

### Multi-Tenancy

```typescript
import { createAnalyticsHooks } from '@hypequery/react';

export const {
  useDataset,
  HypequeryProvider,
} = createAnalyticsHooks<Registry>({
  executor: async (query, context) => {
    // Add tenant ID from context
    const response = await fetch('/api/analytics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': context.tenantId, // From provider
      },
      body: JSON.stringify(query),
    });
    return response.json();
  },
});

// In component
function TenantDashboard() {
  const tenantId = useCurrentTenant(); // Your tenant context

  return (
    <HypequeryProvider value={{ tenantId }}>
      <OrdersChart />
    </HypequeryProvider>
  );
}
```

### Server-Side Rendering (Next.js)

```typescript
// app/dashboard/page.tsx
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { registry } from '@/datasets';
import { prefetchDataset } from '@hypequery/react';

export default async function DashboardPage() {
  const queryClient = new QueryClient();

  // Prefetch on server
  await prefetchDataset(queryClient, {
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue', 'orders.totalOrders'],
    executor: async (query) => {
      // Server-side executor with direct DB access
      const client = createClickHouseClient();
      return client.query(query);
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardContent />
    </HydrationBoundary>
  );
}

// Client component
'use client';
function DashboardContent() {
  const { data } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue', 'orders.totalOrders'],
  });

  // Data is already available from server prefetch
  return <div>Revenue: ${data?.rows[0]?.['orders.totalRevenue']}</div>;
}
```

## API Reference

### `createAnalyticsHooks(config)`

Creates hooks configured for your dataset registry.

**Parameters:**
- `config.executor`: Function to execute queries
  - Receives: `(query: { sql: string, parameters?: any }, context?: any) => Promise<QueryResult>`
  - Returns: Query result with rows

**Returns:**
```typescript
{
  useDataset: <D extends Dataset>(options: UseDatasetOptions<D>) => UseQueryResult<QueryResult<D>>;
  useMetric: <M extends Metric>(metric: M, options?: UseMetricOptions) => UseQueryResult<QueryResult>;
  useMutation: <TData, TVariables>(options: UseMutationOptions<TData, TVariables>) => UseMutationResult<TData, TVariables>;
  HypequeryProvider: React.FC<{ value?: any; children: React.ReactNode }>;
  prefetchDataset: (queryClient: QueryClient, options: PrefetchOptions) => Promise<void>;
}
```

### `useDataset(options)`

**Type Safety:** Fields, dimensions, and filters are fully typed based on the dataset.

```typescript
// TypeScript knows available fields
const { data } = useDataset({
  dataset: registry.datasets.orders,
  fields: [
    'orders.totalRevenue',  // ✓ Valid
    'orders.invalid',        // ✗ Type error
  ],
  dimensions: ['orders.createdAt'], // ✓ Valid dimension
  filters: {
    'orders.status': { equals: 'completed' }, // ✓ Valid filter
    'orders.invalid': { equals: 'foo' },       // ✗ Type error
  },
});

// Result rows are typed
data?.rows[0]['orders.totalRevenue']; // number
data?.rows[0]['orders.createdAt'];    // string (ISO date)
```

### `useMetric(metric, options)`

**Parameters:**
- `metric`: Metric definition from `defineMetric()`
- `options`: Additional query options (dimensions, filters, etc.)

**Returns:** Same as `useDataset()`

### `useMutation(options)`

Thin wrapper around TanStack Query's `useMutation` with type safety.

**Parameters:**
- All TanStack Query mutation options

**Returns:** Standard `UseMutationResult`

### `HypequeryProvider`

Context provider for sharing configuration across hooks.

**Props:**
- `value?`: Context value (e.g., tenant ID, auth token)
- `children`: React children

### `prefetchDataset(queryClient, options)`

Server-side helper for prefetching queries.

**Parameters:**
- `queryClient`: TanStack Query client
- `options`: Same as `useDataset()` plus `executor` function

**Returns:** `Promise<void>`

## Integration Examples

### With Recharts

```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function RevenueChart() {
  const { data, isLoading } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.createdAt', 'orders.totalRevenue'],
    dimensions: ['orders.createdAt'],
    granularity: 'day',
    dateRange: {
      start: '2024-01-01',
      end: '2024-12-31',
    },
  });

  if (isLoading) return <div>Loading...</div>;

  const chartData = data?.rows.map((row) => ({
    date: row['orders.createdAt'],
    revenue: row['orders.totalRevenue'],
  }));

  return (
    <LineChart width={800} height={400} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey="revenue" stroke="#8884d8" />
    </LineChart>
  );
}
```

### With shadcn/ui Tables

```typescript
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function OrdersTable() {
  const { data, isLoading } = useDataset({
    dataset: registry.datasets.orders,
    fields: [
      'orders.orderId',
      'orders.user.email',
      'orders.amount',
      'orders.status',
      'orders.createdAt',
    ],
    dimensions: [
      'orders.orderId',
      'orders.user.email',
      'orders.amount',
      'orders.status',
      'orders.createdAt',
    ],
    orderBy: [{ field: 'orders.createdAt', direction: 'desc' }],
    limit: 50,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order ID</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data?.rows.map((row) => (
          <TableRow key={row['orders.orderId']}>
            <TableCell>{row['orders.orderId']}</TableCell>
            <TableCell>{row['orders.user.email']}</TableCell>
            <TableCell>${row['orders.amount']}</TableCell>
            <TableCell>{row['orders.status']}</TableCell>
            <TableCell>{new Date(row['orders.createdAt']).toLocaleDateString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### With React Hook Form

```typescript
import { useForm } from 'react-hook-form';
import { useMutation } from './hooks/analytics';

function CreateOrderForm() {
  const { register, handleSubmit } = useForm();

  const createOrder = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset', 'orders'] });
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => createOrder.mutate(data))}>
      <input {...register('userId')} placeholder="User ID" />
      <input {...register('amount')} placeholder="Amount" type="number" />
      <button type="submit" disabled={createOrder.isPending}>
        {createOrder.isPending ? 'Creating...' : 'Create Order'}
      </button>
    </form>
  );
}
```

## Best Practices

### 1. Use Query Keys Correctly

```typescript
// ✅ Good - Stable query keys
const { data } = useDataset({
  dataset: registry.datasets.orders,
  fields: ['orders.totalRevenue'],
  filters: useMemo(() => ({
    'orders.status': { equals: status },
  }), [status]),
});

// ❌ Avoid - New object every render causes refetching
const { data } = useDataset({
  dataset: registry.datasets.orders,
  fields: ['orders.totalRevenue'],
  filters: {
    'orders.status': { equals: status }, // New object reference
  },
});
```

### 2. Handle Loading and Error States

```typescript
function OrdersWidget() {
  const { data, isLoading, isError, error } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue'],
  });

  if (isLoading) {
    return <Skeleton />;
  }

  if (isError) {
    return <ErrorMessage error={error} />;
  }

  if (!data?.rows.length) {
    return <EmptyState />;
  }

  return <div>Revenue: ${data.rows[0]['orders.totalRevenue']}</div>;
}
```

### 3. Prefetch on Hover

```typescript
function OrderLink({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();

  const prefetchOrder = () => {
    queryClient.prefetchQuery({
      queryKey: ['order', orderId],
      queryFn: () => fetchOrder(orderId),
    });
  };

  return (
    <Link
      href={`/orders/${orderId}`}
      onMouseEnter={prefetchOrder}
    >
      Order #{orderId}
    </Link>
  );
}
```

### 4. Use Suspense for Cleaner Components

```typescript
import { Suspense } from 'react';

function DashboardPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <OrdersChart />
      <UsersChart />
    </Suspense>
  );
}

// Component without loading state
function OrdersChart() {
  const { data } = useDataset({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue'],
    suspense: true, // Enable suspense mode
  });

  // data is always defined in suspense mode
  return <div>Revenue: ${data.rows[0]['orders.totalRevenue']}</div>;
}
```

### 5. Invalidate Queries Strategically

```typescript
const createOrder = useMutation({
  mutationFn: createOrderApi,
  onSuccess: () => {
    // ✅ Good - Invalidate specific queries
    queryClient.invalidateQueries({ queryKey: ['dataset', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['metric', 'totalRevenue'] });
  },
});

// ❌ Avoid - Invalidating everything
queryClient.invalidateQueries(); // Refetches ALL queries
```

## Troubleshooting

### Query Not Refetching

**Problem:** Data doesn't update when it should

**Solution:** Check staleTime and refetchOnWindowFocus settings:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0, // Always refetch
      refetchOnWindowFocus: true,
    },
  },
});
```

### Type Errors with Field Names

**Problem:** TypeScript complains about field names

**Solution:** Ensure registry is properly typed:

```typescript
// Export and import registry type
export const registry = createDatasetRegistry({ orders, users });
export type Registry = typeof registry;

// Use in hook creation
export const { useDataset } = createAnalyticsHooks<Registry>({
  executor,
});
```

### Infinite Refetching

**Problem:** Query refetches continuously

**Solution:** Stabilize filter objects with useMemo:

```typescript
const filters = useMemo(() => ({
  'orders.status': { equals: status },
}), [status]);

const { data } = useDataset({
  dataset: registry.datasets.orders,
  fields: ['orders.totalRevenue'],
  filters, // Stable reference
});
```

### SSR Hydration Mismatch

**Problem:** Content differs between server and client

**Solution:** Use HydrationBoundary correctly:

```typescript
// Server component
export default async function Page() {
  const queryClient = new QueryClient();
  await prefetchDataset(queryClient, { /* options */ });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ClientComponent />
    </HydrationBoundary>
  );
}
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 - see [LICENSE](../../LICENSE) for details.

## Links

- [Documentation](https://hypequery.com/docs)
- [GitHub Repository](https://github.com/hypequery/hypequery)
- [Issue Tracker](https://github.com/hypequery/hypequery/issues)
- [npm Package](https://www.npmjs.com/package/@hypequery/react)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
