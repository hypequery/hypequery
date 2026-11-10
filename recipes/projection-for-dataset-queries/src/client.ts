import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';

/** Defaults match the shared seed in examples/_seed/docker-compose.yml. */
export const connection = {
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
};

export const db = createQueryBuilder(connection);

export const analytics = createDatasetClient({ queryBuilder: db });
