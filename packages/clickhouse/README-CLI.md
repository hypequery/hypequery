# ClickHouse TypeScript schema generator

`hypequery-generate-types` reads a live ClickHouse schema and writes the `IntrospectedSchema` TypeScript interface used by `@hypequery/clickhouse`. Generated types keep table names, column names, nullable values, arrays, dates, and large integers aligned with what ClickHouse returns over HTTP.

Most projects should use the friendlier main CLI:

```bash
npm install -D @hypequery/cli
npx hypequery generate
```

Use the lower-level binary when you only installed `@hypequery/clickhouse` or want direct control over the output path.

## Run it

```bash
npm install @hypequery/clickhouse
npx hypequery-generate-types ./analytics/schema.ts
```

With no path, the command writes `generated-schema.ts` in the current directory.

## Connection settings

| Variable | Purpose |
| --- | --- |
| `CLICKHOUSE_URL` | ClickHouse HTTP URL |
| `CLICKHOUSE_HOST` | Deprecated alias for `CLICKHOUSE_URL` |
| `CLICKHOUSE_USER` | Username |
| `CLICKHOUSE_PASSWORD` | Password |
| `CLICKHOUSE_DATABASE` | Database to introspect |

```bash
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_USER=default \
CLICKHOUSE_PASSWORD=secret \
CLICKHOUSE_DATABASE=analytics \
npx hypequery-generate-types ./analytics/schema.ts
```

## Use the result

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

Regenerate after schema changes so TypeScript catches application queries that need updating.

## Documentation

- [Quick start](https://hypequery.com/docs/quick-start)
- [Connection reference](https://hypequery.com/docs/reference/connection)
- [Query builder](https://hypequery.com/clickhouse-query-builder)

## License

Apache-2.0.
