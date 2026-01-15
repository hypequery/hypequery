# hypequery

Type-safe analytics layer for ClickHouse. Define metrics once with `defineServe`, execute them anywhere (inline, HTTP, React, agents), and keep everything backed by your ClickHouse schema.

## Quick Start

```bash
# No installation needed
npx @hypequery/cli init
```

Or if you have the CLI installed:

```bash
npx hypequery init
```

Need to reuse the output/input types elsewhere (React components, API handlers, SDKs)? The helper types make that painless:

```ts
import type { InferQueryInput, InferQueryOutput, InferQueryResult } from '@hypequery/serve';
import type { api } from './analytics/api';

type ActiveUsersInput = InferQueryInput<typeof api, 'activeUsers'>;      // input schema
type ActiveUsersResult = InferQueryResult<typeof api, 'activeUsers'>;    // query return type (from ctx.db)
type ActiveUsersResponse = InferQueryOutput<typeof api, 'activeUsers'>;  // Zod schema output if provided
```

- `InferQueryResult` mirrors the actual return type from your query implementation—perfect when you rely on the builder’s static typing.
- `InferQueryOutput` reads the optional `outputSchema` if you need runtime validation to drive typing.
- Both accept either the `serve.define` instance or a raw `ServeQueriesMap`, so you can point them at any slice of your analytics surface.

### Define analytics

```typescript
import { initServe, type InferQueryResult } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './analytics/client.js';

const serve = initServe({
  context: () => ({ db }),
});
const { query } = serve;

export const api = serve.define({
  queries: serve.queries({
    activeUsers: query
      .describe('List active users')
      .input(z.object({ region: z.string().optional() }).default({}))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('users')
          .where('status', 'eq', 'active')
          .where('region', 'eq', input.region ?? 'us')
      ),
  }),
});

// Export typed helpers for downstream usage
export type ActiveUsersResult = InferQueryResult<typeof api, 'activeUsers'>;
```

### Execute everywhere

**Inline**
```typescript
const users = await api.execute('activeUsers');
```

**HTTP API**
```bash
GET /api/activeUsers
```

**React**
```typescript
const { data } = useQuery('activeUsers');
```

One definition. Every consumer.

## Why `defineServe`

- 🔁 Reuse metrics across SSR routes, background jobs, cron tasks, and agents
- 🧩 Built-in HTTP server with docs + OpenAPI (`hypequery dev`)
- 🔐 Auth, multi-tenant helpers, and lifecycle hooks
- ⚡ Query-level caching, logging, streaming, and analytics
- 🧪 Type-safe execution + schema-aware validation

## CLI

**No installation required** – run commands directly with `npx`:

```bash
# Scaffold analytics folder + env vars
npx @hypequery/cli init

# Dev server with docs & OpenAPI
npx @hypequery/cli dev

# Regenerate schema types
npx @hypequery/cli generate

# Emit typed client helpers for API routes
npx @hypequery/cli create-api-types
```

Or install for shorter commands:

```bash
npm install -D @hypequery/cli

# Then use:
npx hypequery init
npx hypequery dev
```

**TypeScript support**: The CLI auto-detects `.ts` files. Just make sure `tsx` is installed:

```bash
npm install -D tsx
```

See the [CLI documentation](https://github.com/hypequery/hypequery/tree/main/packages/cli#readme) for all options.

## Features

- **Type-safe definitions** – strong typing for inputs, outputs, joins, filters
- **SQL expression helpers** – `raw`, `rawAs`, `selectExpr`, `toDateTime`, etc.
- **Advanced filtering** – predicate builders, nested `whereGroup`, custom operators
- **Caching & observability** – SWR cache modes, deduplication, query logging
- **Streaming** – Web Streams for large datasets

## Manual Installation

Need to wire things up by hand? See the [Manual Installation guide](https://hypequery.com/docs/quickstart/installation).

## Advanced (Standalone Query Builder)

Most teams never touch the low-level query builder. If you truly need it outside `defineServe` (scripts, custom runtimes, migrations), read the [Standalone Query Builder](https://hypequery.com/docs/advanced/standalone-query-builder) guide.

## License

Apache-2.0 © hypequery
