import { createQueryBuilder, MemoryCacheProvider } from '@hypequery/clickhouse';
import type { Schema } from './schema.js';

/**
 * Defaults match the shared seed in examples/_seed/docker-compose.yml.
 *
 * `cache` keeps identical queries off ClickHouse for 30 seconds: dashboards
 * that poll the same endpoint every few seconds hit memory, not the cluster.
 */
export const db = createQueryBuilder<Schema>({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
  cache: {
    mode: 'cache-first',
    ttlMs: 30_000,
    provider: new MemoryCacheProvider({ maxEntries: 500 }),
  },
});
