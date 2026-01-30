
## hypequery

### The type-safe analytics backend for ClickHouse. Define metrics once, execute them anywhere (inline, HTTP, React, agents), and keep everything backed by your ClickHouse schema.

<p align="center">
  <a href="https://hypequery.com/docs">Docs</a> •
  <a href="https://hypequery.featurebase.app/roadmap">Roadmap</a> •
  <a href="https://github.com/hypequery/hypequery-examples">Examples</a>
</p>


## Quick Start

```bash
# No installation needed
npx @hypequery/cli init
```

Or if you have the CLI installed:

```bash
npx hypequery init
```

### Define your type safe queries in TypeScript

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
      .input(z.object({ region: z.string() }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('users')
          .where('status', 'eq', 'active')
          .where('region', 'eq', input.region)
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

## Why hypequery

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
```

Or install for shorter commands:

```bash
npm install -D @hypequery/cli

# Then use:
npx hypequery init
npx hypequery dev
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
