<div align="center">
  <h1>hypequery</h1>
  <p>Type-Safe Analytics Runtime for ClickHouse Teams</p>

  [![GitHub license](https://img.shields.io/github/license/hypequery/hypequery)](https://github.com/hypequery/hypequery/blob/main/LICENSE)
  [![npm version](https://badge.fury.io/js/@hypequery%2Fclickhouse.svg)](https://badge.fury.io/js/@hypequery%2Fclickhouse)
  [![GitHub stars](https://img.shields.io/github/stars/hypequery/hypequery)](https://github.com/hypequery/hypequery/stargazers)
</div>

## What is hypequery?

hypequery is a TypeScript-first runtime for ClickHouse. Define analytics once, then reuse them everywhere—embedded in jobs, exposed via HTTP, or consumed as React hooks—with full type safety and generated docs/OpenAPI.

- 🧠 **Code-first analytics** – Queries live in TypeScript with typed inputs/outputs and metadata.
- 🔄 **Serve runtime** – `@hypequery/serve` turns definitions into HTTP handlers, docs, and adapters for Node, Fetch/edge, or in-process execution.
- 🧱 **ClickHouse query builder** – `@hypequery/clickhouse` understands your schema and compiles fluent, typed queries.
- ⚛️ **React hooks** – `@hypequery/react` creates `useQuery`/`useMutation` bindings straight from your serve definitions.
- 🛠️ **CLI workflow** – `npx hypequery init` scaffolds schema/client/query files, keeps `.env` synced, and runs the dev server.


## Packages

| Package | Description |
| --- | --- |
| `@hypequery/serve` | Serve runtime with Middlewares, auth, multi-tenancy, docs, OpenAPI, and adapters (`api.run`, `api.route`, `api.handler`, `api.start`). |
| `@hypequery/clickhouse` | Type-safe query builder, streaming helpers, schema-driven column inference. Works standalone or inside Serve. |
| `@hypequery/react` | React Query integration that generates hooks directly from your serve definitions. |
| `@hypequery/cli` | Scaffolding (`init`, `generate`), dev server, and release helpers. |

## Quickstart (Serve runtime)

```bash
# Install packages
npm install @hypequery/clickhouse @hypequery/serve
npm install -D @hypequery/cli

# Scaffold analytics (schema.ts, client.ts, queries.ts)
npx hypequery init

# Run the dev server with docs + OpenAPI
npx hypequery dev --port 4000
```

Edit `analytics/queries.ts`:

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { define, queries, query } = initServe({ context: () => ({ db }) });

export const api = define({
  queries: queries({
    activeUsers: query
      .describe('Most recent active users')
      .input(z.object({ limit: z.number().min(1).max(500).default(50) }))
      .query(({ ctx, input }) =>
        ctx.db
          .table('users')
          .where('status', 'eq', 'active')
          .orderBy('created_at', 'DESC')
          .limit(input.limit)
          .select(['id', 'email', 'created_at'])
          .execute()
      ),
  }),
});

// Run in-process (cron, SSR, background jobs)
const latest = await api.run('activeUsers', { limit: 25 });

// Or expose via HTTP
api.route('/active-users', api.queries.activeUsers, { method: 'POST' });
```

`npx hypequery dev` watches the file, reloads docs at http://localhost:4000/docs, and emits an OpenAPI spec at http://localhost:4000/openapi.json.

## Query builder quickstart

`@hypequery/clickhouse` works inside Serve or standalone scripts.

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'https://example.clickhouse.cloud:8443',
  username: 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default',
});

const results = await db
  .table('trips')
  .select(['pickup_datetime', 'dropoff_datetime', 'total_amount'])
  .where('total_amount', '>', 50)
  .orderBy('pickup_datetime', 'DESC')
  .limit(10)
  .execute();
```

### Browser / universal environments

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client-web';
import type { IntrospectedSchema } from './generated-schema';

const client = createClient({
  host: 'https://example.clickhouse.cloud:8443',
  username: 'default',
  password: '',
  database: 'default',
});

const db = createQueryBuilder<IntrospectedSchema>({ client });
```

## Schema generation

Generate TypeScript types from ClickHouse via the CLI:

```bash
# Outputs analytics/schema.ts
npx hypequery generate --host https://example.clickhouse.cloud:8443 --database default
```

Then import the schema wherever you initialize the builder:

```ts
import type { IntrospectedSchema } from './analytics/schema';
const db = createQueryBuilder<IntrospectedSchema>({ host: '...', username: '...' });
```

## Advanced builder features

The fluent API supports joins, aggregations, function predicates, streaming, and cross-filtering:

```ts
const stats = await db.table('trips')
  .avg('total_amount')
  .max('trip_distance')
  .count('trip_id')
  .where('pickup_datetime', 'gte', '2024-01-01')
  .execute();

const tripsWithDrivers = await db.table('trips')
  .select(['trips.trip_id', 'trips.total_amount', 'drivers.name'])
  .join('drivers', 'trips.driver_id', 'drivers.id')
  .orderBy('trips.trip_id', 'DESC')
  .execute();

const taggedProducts = await db.table('products')
  .where((expr) => expr.and([
    expr.fn('hasAny', 'tags', ['launch', 'beta']),
    expr.fn('endsWith', 'status', expr.literal('active')),
  ]))
  .orWhere((expr) => expr.fn('notEmpty', 'tags'))
  .execute();
```

## Next steps

- [Docs](https://hypequery.com/docs)
- [Getting Started Guide](https://hypequery.com/docs/getting-started/quickstart)
- [Recipes](https://hypequery.com/docs/recipes)
- [Open an issue](https://github.com/hypequery/hypequery/issues)
