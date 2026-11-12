import { createQueryBuilder, logger } from '@hypequery/clickhouse';
import type { Schema } from './schema.js';

/** Defaults match the shared seed in examples/_seed/docker-compose.yml. */
export const connection = {
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
};

/**
 * hypequery's insert builder sends rows through the official
 * @clickhouse/client as JSONEachRow. Concurrent inserts each hold an HTTP
 * connection until they return, so the pool must be at least as large as
 * the number of inserts in flight (the client's default is 10).
 */
export const CONCURRENCY = 100;

export const db = createQueryBuilder<Schema>({ ...connection, max_open_connections: CONCURRENCY });

// The builder logs every query at info level; keep the recipe's output to the results.
logger.configure({ level: 'warn' });
