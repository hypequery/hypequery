import { createClient, type ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseEnvConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

let client: ClickHouseClient | null = null;

function readEnv(name: string, fallback?: string) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function getClickHouseConfigFromEnv(): ClickHouseEnvConfig | null {
  const url = readEnv('CLICKHOUSE_URL') ?? readEnv('CLICKHOUSE_HOST');

  if (!url) {
    return null;
  }

  return {
    url,
    username: readEnv('CLICKHOUSE_USERNAME', readEnv('CLICKHOUSE_USER', 'default'))!,
    password: readEnv('CLICKHOUSE_PASSWORD', readEnv('CLICKHOUSE_PASS', ''))!,
    database: readEnv('CLICKHOUSE_DATABASE', 'default')!,
  };
}

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    const config = getClickHouseConfigFromEnv();

    if (!config) {
      throw new Error(
        'ClickHouse connection details are missing. Set CLICKHOUSE_HOST (or CLICKHOUSE_URL), CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME, and CLICKHOUSE_PASSWORD.'
      );
    }

    client = createClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
    });
  }

  return client;
}

export async function resetClickHouseClientForTesting() {
  if (client) {
    await client.close();
    client = null;
  }
}
