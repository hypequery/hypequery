<p align="center">
  <img src="./website-next/public/logo.png" alt="hypequery logo" width="450" />
</p>

<p align="center">
 <h3 align="center">The type-safe analytics backend for ClickHouse</h3>
</p>

<h4 align="center">Define metrics once, execute them anywhere (inline, HTTP, React, agents), and keep everything backed by your ClickHouse schema.</h4>

<p align="center">
  <a href="https://github.com/hypequery/hypequery/blob/main/LICENSE">
    <img alt="hypequery license: Apache-2.0" src="https://img.shields.io/badge/hypequery-license%20Apache%202.0-2ea44f?style=for-the-badge" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/cli">
    <img alt="npm @hypequery/cli" src="https://img.shields.io/npm/v/%40hypequery%2Fcli?style=for-the-badge&label=%40hypequery%2Fcli" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/clickhouse">
    <img alt="npm @hypequery/clickhouse" src="https://img.shields.io/npm/v/%40hypequery%2Fclickhouse?style=for-the-badge&label=%40hypequery%2Fclickhouse" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/serve">
    <img alt="npm @hypequery/serve" src="https://img.shields.io/npm/v/%40hypequery%2Fserve?style=for-the-badge&label=%40hypequery%2Fserve" />
  </a>
  <a href="https://www.npmjs.com/package/@hypequery/react">
    <img alt="npm @hypequery/react" src="https://img.shields.io/npm/v/%40hypequery%2Freact?style=for-the-badge&label=%40hypequery%2Freact" />
  </a>
</p>

<p align="center">
  <a href="https://hypequery.com/docs">Docs</a> •
  <a href="https://hypequery.featurebase.app/roadmap">Roadmap</a> •
  <a href="https://github.com/hypequery/hypequery-examples">Examples</a>
</p>

## Why hypequery

- 🔁 Reuse metrics across SSR routes, background jobs, cron tasks, and agents
- 🧩 Built-in HTTP server with docs + OpenAPI (`hypequery dev`)
- 🔐 Auth, multi-tenant helpers, and lifecycle hooks
- ⚡ Query-level caching, logging, streaming, and analytics
- 🧪 Type-safe execution + schema-aware validation

## Quick Start

Start with the CLI:

```bash
npm install -D @hypequery/cli
npx hypequery init
```

## Query Builder

Get started with type-safe ClickHouse queries in seconds. Generate TypeScript types from your schema, then build queries with full autocomplete and compile-time safety.

```bash
# Generate types from your ClickHouse schema
npm install @hypequery/clickhouse
npx hypequery generate
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default',
});

// Fully type-safe — columns, operators, and return types are all inferred
const revenue = await db
  .table('orders')
  .where('created_at', 'gte', '2026-01-01')
  .sum('total', 'revenue')
  .groupBy(['region'])
  .execute();
```

No SQL strings. No runtime surprises when your schema changes.

## Add Query Definitions And Serve When You Need Them

Start with the query builder for local typed execution. Add `@hypequery/serve` when a query becomes a reusable contract or needs an HTTP surface.

```typescript
import { initServe, type InferQueryResult } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './analytics/client';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const activeUsers = query({
  description: 'List active users',
  input: z.object({ region: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('users')
      .where('status', 'eq', 'active')
      .where('region', 'eq', input.region)
      .execute(),
});

export const api = serve({
  queries: { activeUsers },
});

// Export typed helpers for downstream usage
export type ActiveUsersResult = InferQueryResult<typeof api, 'activeUsers'>;
```

### Execute everywhere

**Inline**
```typescript
const users = await api.run('activeUsers', { input: { region: 'EU' } });
```

**HTTP API**
```bash
POST /api/analytics/activeUsers
```

**React**
```typescript
const { data } = useQuery('activeUsers', { region: 'EU' });
```

**AI Agent**
```typescript
const catalog = api.describe();
const result = await api.run('activeUsers', { input: { region: 'EU' } });
```

One query definition. Every consumer.

## CLI

```bash
# Scaffold analytics folder + env vars
npx @hypequery/cli init

# Dev server with docs & OpenAPI
npx @hypequery/cli dev

# Regenerate schema types
npx @hypequery/cli generate
```

See the [CLI documentation](https://github.com/hypequery/hypequery/tree/main/packages/cli#readme) for all options.

## Features

- **Type-safe definitions** – strong typing for inputs, outputs, joins, filters
- **SQL expression helpers** – `raw`, `rawAs`, `selectExpr`, `toDateTime`, etc.
- **Advanced filtering** – predicate builders, nested `whereGroup`, custom operators
- **Caching & observability** – SWR cache modes, deduplication, query logging
- **Streaming** – Web Streams for large datasets

## License

Copyright 2026 hypequery

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

See [LICENSE](LICENSE) for the full license text.
