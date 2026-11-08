/**
 * Connection settings, read from the same env vars the repo's testing specs
 * use (`testing/README.md`), with defaults matching docker-compose.yml.
 */
export interface SeedConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export const DEFAULT_CONFIG: SeedConfig = {
  url: 'http://localhost:8123',
  username: 'default',
  password: 'hypequery',
  database: 'hypequery_examples',
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  return {
    url: env.CLICKHOUSE_URL ?? DEFAULT_CONFIG.url,
    username: env.CLICKHOUSE_USERNAME ?? env.CLICKHOUSE_USER ?? DEFAULT_CONFIG.username,
    password: env.CLICKHOUSE_PASSWORD ?? DEFAULT_CONFIG.password,
    database: env.CLICKHOUSE_DATABASE ?? DEFAULT_CONFIG.database,
  };
}
