# @hypequery/clickhouse

Typed ClickHouse query builder for hypequery.

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

## Semantic Datasets

For datasets-first analytics, use the datasets subpath. This gives you one
ClickHouse-backed semantic client without creating a query builder directly.

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
} from '@hypequery/clickhouse/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('total'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });

const analytics = createDatasetClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});

await analytics.metric(revenue, {
  dimensions: ['country'],
});

await analytics.dataset(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});
```

If you use both the query builder and semantic datasets, make the query builder
the root object and enter the semantic layer through `db.datasets()`. Using the
`revenue` metric defined above:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});

const analytics = db.datasets();

await db
  .table('orders')
  .select(['country'])
  .sum('total', 'revenue')
  .groupBy('country')
  .execute();

await analytics.metric(revenue, {
  dimensions: ['country'],
});
```

`createDatasetClient(config)` is the datasets-only convenience form of
`createQueryBuilder(config).datasets()`. `db.datasets()` shares the same
ClickHouse adapter, cache runtime, connection config, and execution settings as
`db`; it does not accept a second datasets-specific config object. Use a second
`createQueryBuilder(...)` only when semantic queries need a different
connection or scope.

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
