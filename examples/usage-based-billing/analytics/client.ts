import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';

/** Defaults match the shared seed in examples/_seed/docker-compose.yml. */
export const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
});

/** One client for the invoice job, the usage endpoint and the MRR chart. */
export const analytics = createDatasetClient({ queryBuilder: db, timezone: 'UTC' });
