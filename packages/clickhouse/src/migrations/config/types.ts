export const DEFAULT_MIGRATIONS_OUT_DIR = './migrations';
export const DEFAULT_MIGRATIONS_TABLE = '_hypequery_migrations';
export const DEFAULT_MIGRATIONS_PREFIX = 'timestamp' as const;

export type MigrationFilePrefix = typeof DEFAULT_MIGRATIONS_PREFIX;

export interface ClickHouseMigrationDirectoryConfig {
  out: string;
  table: string;
  prefix: MigrationFilePrefix;
}

export interface ClickHouseMigrationDbCredentials {
  host: string;
  port?: number;
  username: string;
  password?: string;
  database: string;
  secure?: boolean;
}

export interface ClickHouseClusterConfig {
  name: string;
}

export interface HypequeryClickHouseConfig {
  dialect: 'clickhouse';
  schema: string;
  migrations?: Partial<ClickHouseMigrationDirectoryConfig>;
  dbCredentials: ClickHouseMigrationDbCredentials;
  cluster?: ClickHouseClusterConfig;
}

export interface ResolvedHypequeryClickHouseConfig
  extends Omit<HypequeryClickHouseConfig, 'migrations'> {
  migrations: ClickHouseMigrationDirectoryConfig;
}

export function defineConfig(config: HypequeryClickHouseConfig): HypequeryClickHouseConfig {
  return config;
}

export function resolveClickHouseConfig(
  config: HypequeryClickHouseConfig,
): ResolvedHypequeryClickHouseConfig {
  return {
    ...config,
    migrations: {
      out: config.migrations?.out ?? DEFAULT_MIGRATIONS_OUT_DIR,
      table: config.migrations?.table ?? DEFAULT_MIGRATIONS_TABLE,
      prefix: config.migrations?.prefix ?? DEFAULT_MIGRATIONS_PREFIX,
    },
  };
}
