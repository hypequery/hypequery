import type {
  HypequeryClickHouseConfig,
  ResolvedHypequeryClickHouseConfig,
} from '@hypequery/schema';
import { loadModule } from './load-api.js';

export const DEFAULT_HYPEQUERY_CONFIG_PATH = 'hypequery.config.ts';
export const DEFAULT_MIGRATIONS_OUT_DIR = './migrations';
export const DEFAULT_MIGRATIONS_TABLE = '_hypequery_migrations';
export const DEFAULT_MIGRATIONS_PREFIX = 'timestamp' as const;

export async function loadHypequeryConfig(
  configPath = DEFAULT_HYPEQUERY_CONFIG_PATH,
): Promise<ResolvedHypequeryClickHouseConfig> {
  const mod = await loadModule(configPath);
  const candidate = mod.default ?? mod.config;

  if (!candidate || typeof candidate !== 'object') {
    throw new Error(
      `Invalid hypequery config: ${configPath}\n\n` +
      `The config module must export a ClickHouse config as the default export.`,
    );
  }

  const config = candidate as Partial<HypequeryClickHouseConfig>;

  if (config.dialect !== 'clickhouse') {
    throw new Error(
      `Invalid hypequery config: ${configPath}\n\n` +
      `Expected "dialect" to be "clickhouse".`,
    );
  }

  if (typeof config.schema !== 'string' || config.schema.length === 0) {
    throw new Error(
      `Invalid hypequery config: ${configPath}\n\n` +
      `Expected "schema" to be a non-empty string.`,
    );
  }

  if (!config.dbCredentials || typeof config.dbCredentials !== 'object') {
    throw new Error(
      `Invalid hypequery config: ${configPath}\n\n` +
      `Expected "dbCredentials" to be defined.`,
    );
  }

  return {
    ...(config as HypequeryClickHouseConfig),
    migrations: {
      out: config.migrations?.out ?? DEFAULT_MIGRATIONS_OUT_DIR,
      table: config.migrations?.table ?? DEFAULT_MIGRATIONS_TABLE,
      prefix: config.migrations?.prefix ?? DEFAULT_MIGRATIONS_PREFIX,
    },
  };
}
