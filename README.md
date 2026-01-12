# hypequery

Type-safe analytics layer for ClickHouse. Define metrics once with `defineServe`, execute them anywhere (inline, HTTP, React, agents), and keep everything backed by your ClickHouse schema.

## Quick Start

```bash
npx hypequery init
```

### Define analytics

```typescript
import { defineServe } from '@hypequery/serve';
import { db } from './analytics/client.js';

export const api = defineServe({
  context: () => ({ db }),
  queries: {
    activeUsers: {
      query: async ({ ctx }) =>
        ctx.db.table('users')
          .where('status', 'eq', 'active'),
    },
  },
});
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

```bash
# Scaffold analytics folder + env vars
npx hypequery init

# Regenerate schema types
npx hypequery generate

# Dev server with docs & OpenAPI
npx hypequery dev
```

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
