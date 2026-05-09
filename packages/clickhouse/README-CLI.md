# hypequery Type Generator

`hypequery-generate-types` introspects your ClickHouse schema and writes a TypeScript interface you can use with `createQueryBuilder()`.

Most users should prefer:

```bash
npx hypequery generate
```

This file documents the lower-level binary that ships with `@hypequery/clickhouse`.

## Install

```bash
npm install @hypequery/clickhouse
```

## Usage

```bash
npx hypequery-generate-types
```

By default it:

- reads ClickHouse connection details from environment variables
- introspects tables in the target database
- writes `generated-schema.ts` in the current working directory

Custom output path:

```bash
npx hypequery-generate-types ./src/types/db-schema.ts
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `CLICKHOUSE_URL` | Preferred ClickHouse URL |
| `CLICKHOUSE_HOST` | Deprecated alias for `CLICKHOUSE_URL` |
| `CLICKHOUSE_USER` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | ClickHouse database |

Example:

```bash
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_USER=default \
CLICKHOUSE_PASSWORD=secret \
CLICKHOUSE_DATABASE=analytics \
npx hypequery-generate-types ./analytics/schema.ts
```

## Using The Generated Types

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

## Docs

- [Quick start](https://hypequery.com/docs/quick-start)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)

## License

Apache-2.0.
