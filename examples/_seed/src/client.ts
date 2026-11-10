import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { SeedConfig } from './config.js';

/** A client bound to one database. Admin statements use `system`. */
export function createSeedClient(config: SeedConfig, database: string = config.database): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database,
  });
}
