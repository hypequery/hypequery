# @hypequery/react

Type-safe React hooks for hypequery APIs. Wraps your generated API definition in thin TanStack Query shims so you can call `useQuery('weeklyRevenue')` with end-to-end type safety.

## Installation

```bash
npm install @hypequery/react @tanstack/react-query
```

Peer dependencies: `react@^18`, `@tanstack/react-query@^5`.

## Quick Start

```ts
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { Api } from '@/analytics/queries';

export const { useQuery, useMutation } = createHooks<Api>({
  baseUrl: '/api',
});
```

Wrap your app with TanStack Query's provider:

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

Use the hooks in your components:

```tsx
// Query
const { data, error, isLoading } = useQuery('weeklyRevenue', { startDate: '2025-01-01' });

// Mutation
const rebuild = useMutation('rebuildMetrics');
rebuild.mutate({ force: true });
```

---

## API Reference

### `createHooks<Api>(config)`

Factory function that creates type-safe `useQuery` and `useMutation` hooks for your API.

**Parameters:**

```ts
interface CreateHooksConfig<TApi> {
  baseUrl: string;                          // Required: API base URL (e.g., '/api' or 'https://api.example.com')
  fetchFn?: typeof fetch;                   // Optional: Custom fetch implementation (defaults to global fetch)
  headers?: Record<string, string> | (() => Record<string, string>); // Optional: Default headers or a resolver function
  config?: Record<string, QueryMethodConfig>; // Optional: Per-route HTTP method overrides
  api?: TApi;                               // Optional: API object to auto-extract HTTP methods
}

interface QueryMethodConfig {
  method?: string; // HTTP method: 'GET', 'POST', 'PUT', 'DELETE', etc.
}
```

**Returns:**

```ts
{
  useQuery: <Name>(name, input?, options?) => UseQueryResult<Output, HttpError>,
  useMutation: <Name>(name, options?) => UseMutationResult<Output, HttpError, Input>
}
```

**Example:**

```ts
const { useQuery, useMutation } = createHooks<Api>({
  baseUrl: 'https://api.example.com',
  headers: {
    'X-API-Key': process.env.API_KEY,
  },
  config: {
    // Override HTTP method for specific routes
    uploadFile: { method: 'POST' },
  },
});
```

---

### `useQuery(name, input?, options?)`

Type-safe wrapper around TanStack Query's `useQuery`. Automatically infers input and output types from your API definition.

**Signatures:**

```ts
// No input required
useQuery(name: Name)
useQuery(name: Name, options: QueryOptions)

// Input required
useQuery(name: Name, input: Input)
useQuery(name: Name, input: Input, options: QueryOptions)
```

**Parameters:**

- `name` - Query name from your API definition
- `input` - Query input (typed from your API). Optional if query has no input schema
- `options` - TanStack Query options (`enabled`, `staleTime`, `refetchInterval`, etc.)

**Returns:** TanStack Query's `UseQueryResult<Output, HttpError>`

**Examples:**

```tsx
// Simple query with no input
const { data } = useQuery('healthCheck');

// Query with input
const { data, error, isLoading } = useQuery('getUser', { id: '123' });

// Query with options
const { data } = useQuery('getUser', { id: '123' }, {
  enabled: isLoggedIn,
  staleTime: 60000,
  refetchOnWindowFocus: false,
});

// Query without input but with options
const { data } = useQuery('healthCheck', { refetchInterval: 5000 });
```

---

### `useMutation(name, options?)`

Type-safe wrapper around TanStack Query's `useMutation`.

**Parameters:**

- `name` - Mutation name from your API definition
- `options` - TanStack Query mutation options (`onSuccess`, `onError`, `retry`, etc.)

**Returns:** TanStack Query's `UseMutationResult<Output, HttpError, Input>`

**Examples:**

```tsx
// Basic mutation
const createUser = useMutation('createUser');
createUser.mutate({ name: 'Alice', email: 'alice@example.com' });

// Mutation with callbacks
const updateProfile = useMutation('updateProfile', {
  onSuccess: (data) => {
    console.log('Profile updated:', data);
    queryClient.invalidateQueries(['hypequery', 'getProfile']);
  },
  onError: (error) => {
    console.error('Failed to update profile:', error.message);
  },
});

updateProfile.mutate({ bio: 'New bio' });
```

---

### `queryOptions(options)`

Helper function to explicitly mark an object as query options (not input). Useful when your query input and TanStack Query options have overlapping property names.

**Parameters:**

- `options` - TanStack Query options object

**Returns:** The same object with an internal symbol marker

**When to use:**

If your API input has properties like `enabled`, `staleTime`, etc., the library might misclassify input as options. Use `queryOptions()` to disambiguate:

```tsx
// ❌ Ambiguous - could be input or options?
useQuery('getConfig', { enabled: true, staleTime: 5000 });

// ✅ Explicit - this is input
useQuery('getConfig', { enabled: true, staleTime: 5000 });

// ✅ Explicit - these are options
import { queryOptions } from '@hypequery/react';
useQuery('getConfig', queryOptions({ enabled: true, staleTime: 5000 }));
```

---

### `HttpError`

Custom error class thrown by failed HTTP requests. Extends the standard `Error` class with additional properties.

**Properties:**

```ts
class HttpError extends Error {
  readonly status: number;  // HTTP status code (404, 500, etc.)
  readonly body: unknown;   // Parsed response body (JSON or text)
}
```

**Usage:**

```tsx
const { error } = useQuery('getUser', { id: '123' });

if (error) {
  console.log(error.message);  // "GET request to /api/getUser failed with status 404"
  console.log(error.status);   // 404
  console.log(error.body);     // { message: "User not found" }

  // Type-safe instanceof check
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return <NotFound />;
    }
  }
}
```

**Error handling example:**

```tsx
import { HttpError } from '@hypequery/react';

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useQuery('getUser', { id: userId });

  if (isLoading) return <Spinner />;

  if (error instanceof HttpError) {
    switch (error.status) {
      case 404:
        return <NotFound message="User not found" />;
      case 403:
        return <Unauthorized />;
      case 500:
        return <ServerError details={error.body} />;
      default:
        return <Error message={error.message} />;
    }
  }

  return <div>{data.name}</div>;
}
```

---

## Advanced Usage

### Custom fetch implementation

```ts
const { useQuery } = createHooks<Api>({
  baseUrl: '/api',
  fetchFn: async (url, init) => {
    // Add authentication token
    const token = await getAuthToken();
    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  },
});
```

### Default headers

```ts
const { useQuery } = createHooks<Api>({
  baseUrl: '/api',
  headers: {
    'X-API-Key': process.env.API_KEY,
    'X-Client-Version': '1.0.0',
  },
});
```

### HTTP method configuration

```ts
const { useQuery } = createHooks<Api>({
  baseUrl: '/api',
  config: {
    // Override default GET for specific queries
    refreshCache: { method: 'POST' },
    deleteUser: { method: 'DELETE' },
  },
});
```

### Auto-extract methods from API object

If your API definition includes HTTP method information, pass it to auto-configure:

```ts
import { api } from '@/analytics/queries';

const { useQuery } = createHooks({
  baseUrl: '/api',
  api, // Automatically extracts method config from api object
});
```

---

## TypeScript

All hooks are fully typed based on your API definition:

```ts
interface Api {
  getUser: {
    input: { id: string };
    output: { name: string; email: string };
  };
  weeklyRevenue: {
    input: { startDate: string };
    output: { total: number };
  };
}

const { useQuery } = createHooks<Api>({ baseUrl: '/api' });

// ✅ TypeScript infers input and output types
const { data } = useQuery('getUser', { id: '123' });
//    ^? { name: string; email: string } | undefined

// ❌ TypeScript error: missing required input
const { data } = useQuery('getUser');

// ❌ TypeScript error: invalid property
const { data } = useQuery('getUser', { userId: '123' });
```

---

## License

MIT
