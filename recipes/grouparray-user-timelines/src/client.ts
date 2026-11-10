import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';
import type { Schema } from './schema.js';

/** Defaults match the shared seed in examples/_seed/docker-compose.yml. */
export const db = createQueryBuilder<Schema>({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
});

export const analytics = createDatasetClient({ queryBuilder: db });
