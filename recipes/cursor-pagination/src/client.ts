import { createQueryBuilder, logger } from '@hypequery/clickhouse';
import type { Schema } from './schema.js';

/** Defaults match the shared seed in examples/_seed/docker-compose.yml. */
export const connection = {
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
};

export const db = createQueryBuilder<Schema>(connection);

// The builder logs every query at info level; keep the recipe's output to the results.
logger.configure({ level: 'warn' });
