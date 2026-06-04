# @hypequery/clickhouse

Typed query builder for ClickHouse.

Use it when you want schema-aware queries, typed results, and a fluent API that stays close to how ClickHouse actually works.

## Install

Node:

```bash
npm install @hypequery/clickhouse
```

Browser or shared client setup:

```bash
npm install @hypequery/clickhouse @clickhouse/client-web
```

`url` is the preferred connection field. `host` is still supported as a deprecated alias.

## Quick Start

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});

const recentOrders = await db
  .table('orders')
  .select(['id', 'user_id', 'total', 'created_at'])
  .where('created_at', 'gte', '2026-01-01')
  .orderBy('created_at', 'DESC')
  .limit(20)
  .execute();
```

## Main Path

1. Generate schema types with the CLI
2. Create a typed `db`
3. Write and execute queries locally
4. Promote important queries into `@hypequery/serve` when they need a shared contract or HTTP surface

## Common Patterns

### Aggregation

```ts
const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
```

### Joins

```ts
const ordersWithUsers = await db
  .table('orders')
  .innerJoin('users', 'user_id', 'users.id')
  .select(['orders.id', 'users.email', 'orders.total'])
  .where('users.status', 'eq', 'active')
  .execute();
```

### ClickHouse-specific features

```ts
const topProductsPerCategory = await db
  .table('products')
  .select(['category', 'id', 'score'])
  .orderBy('score', 'DESC')
  .limitBy(3, 'category')
  .execute();
```

```ts
const explodedTags = await db
  .table('products')
  .select(['id', 'tags'])
  .arrayJoin('tags')
  .execute();
```

`arrayJoin()` and `leftArrayJoin()` only accept array-typed columns.

## Browser Use

In browser environments, create the ClickHouse client explicitly and inject it:

```ts
import { createClient } from '@clickhouse/client-web';
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const client = createClient({
  url: process.env.NEXT_PUBLIC_CLICKHOUSE_URL!,
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USERNAME!,
  password: process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD ?? '',
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE!,
});

const db = createQueryBuilder<IntrospectedSchema>({
  client,
});
```

## Schema Generation

The usual path is through the CLI:

```bash
npm install -D @hypequery/cli
npx hypequery generate
```

The package also ships the lower-level generator binary:

```bash
npx hypequery-generate-types
```

More details: [README-CLI.md](./README-CLI.md)

## Useful Exports

- SQL helpers like `raw`, `rawAs`, `selectExpr`, and `toDateTime`
- exported time helpers like `toStartOfMinute`, `toStartOfHour`, `toStartOfDay`, `toStartOfWeek`, `toStartOfMonth`, `toStartOfQuarter`, and `toStartOfYear`
- cache primitives like `MemoryCacheProvider`

## Docs

- [Query builder basics](https://hypequery.com/docs/query-building/basics)
- [Filtering](https://hypequery.com/docs/query-building/where)
- [Joins](https://hypequery.com/docs/query-building/joins)
- [Aggregation](https://hypequery.com/docs/query-building/aggregation)
- [Connection reference](https://hypequery.com/docs/reference/connection)

## License

Apache-2.0.
