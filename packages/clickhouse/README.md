# @hypequery/clickhouse

The type-safe ClickHouse query builder for TypeScript.

Generate types from your live ClickHouse schema, write fluent analytics queries, and catch broken table names, columns, joins, filters, and result shapes before production. `@hypequery/clickhouse` keeps the power of ClickHouse without the `any[]`, drifting interfaces, and stringly typed application SQL.

## Install

```bash
npm install @hypequery/clickhouse
npm install -D @hypequery/cli
npx hypequery generate
```

## Your first typed query

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});

const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .where('status', 'eq', 'completed')
  .sum('amount', 'revenue')
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
```

The result type is inferred from your real ClickHouse schema and the query itself. Rename a column, regenerate types, and affected queries fail at compile time.

## ClickHouse-first, not lowest-common-denominator SQL

- native `PREWHERE`, `FINAL`, `LIMIT BY`, array joins, totals, settings, and CTEs;
- typed joins, filters, groups, ordering, pagination, and streaming;
- sums, distinct counts, percentiles, `argMax`, `argMin`, standard deviation, and variance;
- explicit expression helpers for window functions and specialised ClickHouse SQL;
- correct runtime types for dates, large integers, nullable values, and arrays.

```ts
const topProducts = await db
  .table('products')
  .final()
  .select(['category', 'id', 'score'])
  .orderBy('score', 'DESC')
  .limitBy(3, 'category')
  .execute();
```

See [what hypequery supports today](https://hypequery.com/docs/capabilities) for the exact public surface.

## Grow beyond one query

When analytics meaning needs to be shared, add `@hypequery/datasets` for a code-first semantic layer, `@hypequery/serve` for validated APIs, `@hypequery/react` for typed hooks, and `@hypequery/mcp` for governed AI-agent access. They all build on this query layer.

## Learn more

- [Quick start](https://hypequery.com/docs/quick-start)
- [Query builder guide](https://hypequery.com/clickhouse-query-builder)
- [Filtering](https://hypequery.com/docs/query-building/where)
- [Aggregation](https://hypequery.com/docs/query-building/aggregation)
- [Schema generation](./README-CLI.md)

## License

Apache-2.0.
