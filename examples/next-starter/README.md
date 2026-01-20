# hypequery + Next.js Starter

A minimal Next.js application with hypequery API routes and React hooks integration.

## Features

- **Automatic data loading** with `@hypequery/react` hooks
- **Type-safe API** from backend to frontend
- **Built-in caching** via TanStack Query
- **No manual fetch calls** - data loads on component mount

## Getting Started

1. Install dependencies:

```bash
npm install
# or
pnpm install
```

2. Run the development server:

```bash
npm run dev
# or
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

The page will automatically load data from the API using React hooks!

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/hypequery/[...hq]/route.ts  # API handler
│   │   ├── layout.tsx                       # Root layout (with providers)
│   │   └── page.tsx                         # Home page (using hooks)
│   ├── lib/
│   │   └── hypequery-client.ts              # Type-safe hooks
│   ├── providers/
│   │   └── query-provider.tsx               # React Query setup
│   └── queries.ts                           # hypequery API definitions
├── package.json
└── tsconfig.json
```

## How It Works

### 1. Define Your Queries (`src/queries.ts`)

```typescript
import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { define, queries, query } = initServe({
  context: () => ({}),
});

export const api = define({
  queries: queries({
    hello: query
      .output(z.object({ message: z.string() }))
      .query(async () => ({ message: 'Hello!' })),
  }),
});

// Register routes
api.route('/hello', api.queries.hello, { method: 'GET' });

// Export type for React hooks
export type StarterApi = {
  hello: { input: void; output: { message: string } };
};
```

### 2. Create Type-Safe Hooks (`src/lib/hypequery-client.ts`)

```typescript
import { createHooks } from '@hypequery/react';
import type { StarterApi } from '@/queries';

export const { useQuery, HypequeryProvider } = createHooks<StarterApi>({
  baseUrl: '/api/hypequery',
});
```

### 3. Use Hooks in Components

```typescript
'use client';

import { useQuery } from '@/lib/hypequery-client';

export default function Page() {
  const { data, isLoading } = useQuery('hello', undefined);

  if (isLoading) return <p>Loading...</p>;

  return <div>{data?.message}</div>;
}
```

Data loads automatically on mount - no buttons or manual fetching needed!

## Adding New Queries

1. **Define the query** in `src/queries.ts`:

```typescript
export const api = define({
  queries: queries({
    myQuery: query
      .output(z.object({ data: z.string() }))
      .query(async () => ({ data: 'Hello!' })),
  }),
});

api.route('/myQuery', api.queries.myQuery, { method: 'GET' });
```

2. **Add to type export**:

```typescript
export type StarterApi = {
  hello: { input: void; output: { message: string } };
  myQuery: { input: void; output: { data: string } }; // Add this
};
```

3. **Use in component**:

```typescript
const { data } = useQuery('myQuery', undefined);
```

TypeScript will autocomplete the query name and infer the response type!

## API Endpoints

You can also call the API directly:
- [http://localhost:3000/api/hypequery/hello](http://localhost:3000/api/hypequery/hello)
- [http://localhost:3000/api/hypequery/stats](http://localhost:3000/api/hypequery/stats)

## Learn More

- [hypequery Documentation](https://hypequery.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [TanStack Query](https://tanstack.com/query/latest)
