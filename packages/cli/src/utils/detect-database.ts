import { access } from 'node:fs/promises';
import path from 'node:path';
import type { ClickHouseConfig } from '@hypequery/clickhouse';

/**
 * Database type detection result
 */
export type DatabaseType = 'clickhouse' | 'bigquery' | 'unknown';

/**
 * Auto-detect database type from environment or config files
 */
export async function detectDatabase(): Promise<DatabaseType> {
  // Check environment variables
  if (
    process.env.CLICKHOUSE_HOST ||
    process.env.CLICKHOUSE_URL ||
    process.env.CLICKHOUSE_DATABASE
  ) {
    return 'clickhouse';
  }

  if (process.env.BIGQUERY_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return 'bigquery';
  }

  // Check for .env file and parse it
  try {
    const envPath = path.join(process.cwd(), '.env');
    await access(envPath);

    const { readFile } = await import('node:fs/promises');
    const envContent = await readFile(envPath, 'utf-8');

    if (
      envContent.includes('CLICKHOUSE_') ||
      envContent.includes('CLICKHOUSE_HOST')
    ) {
      return 'clickhouse';
    }

    if (
      envContent.includes('BIGQUERY_') ||
      envContent.includes('GOOGLE_APPLICATION_CREDENTIALS')
    ) {
      return 'bigquery';
    }

  } catch {
    // .env doesn't exist, continue
  }

  return 'unknown';
}

/**
 * Validate database connection
 */
export async function validateConnection(dbType: DatabaseType): Promise<boolean> {
  switch (dbType) {
    case 'clickhouse':
      return validateClickHouse();
    case 'bigquery':
      return validateBigQuery();
    default:
      return false;
  }
}

async function validateClickHouse(): Promise<boolean> {
  try {
    const client = await getClickHouseClient();

    // Simple ping query
    const result = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    });

    await result.json();
    return true;
  } catch (error) {
    return false;
  }
}

async function validateBigQuery(): Promise<boolean> {
  // TODO: Implement when BigQuery support is added
  return false;
}

/**
 * Get table count from database
 */
export async function getTableCount(dbType: DatabaseType): Promise<number> {
  switch (dbType) {
    case 'clickhouse':
      return getClickHouseTableCount();
    default:
      return 0;
  }
}

async function getClickHouseTableCount(): Promise<number> {
  try {
    const client = await getClickHouseClient();

    const result = await client.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow',
    });

    const tables = await result.json();
    return Array.isArray(tables) ? tables.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get list of tables from database
 */
export async function getTables(dbType: DatabaseType): Promise<string[]> {
  switch (dbType) {
    case 'clickhouse':
      return getClickHouseTables();
    default:
      return [];
  }
}

async function getClickHouseTables(): Promise<string[]> {
  try {
    const client = await getClickHouseClient();

    const result = await client.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow',
    });

    const tables = (await result.json()) as Array<{ name: string }>;
    return tables.map(t => t.name);
  } catch {
    return [];
  }
}

type ClickHouseHostConfig = Exclude<ClickHouseConfig, { client: unknown }>;

async function getClickHouseClient() {
  const { ClickHouseConnection } = await import('@hypequery/clickhouse');

  try {
    return ClickHouseConnection.getClient();
  } catch (error) {
    if (error instanceof Error && error.message.includes('ClickHouse connection not initialized')) {
      const config = getClickHouseEnvConfig();

      if (!config) {
        throw new Error(
          'ClickHouse connection details are missing. Set CLICKHOUSE_HOST, CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME, and CLICKHOUSE_PASSWORD.'
        );
      }

      ClickHouseConnection.initialize(config);
      return ClickHouseConnection.getClient();
    }

    throw error;
  }
}

function getClickHouseEnvConfig(): ClickHouseHostConfig | null {
  const host = process.env.CLICKHOUSE_HOST || process.env.CLICKHOUSE_URL;

  if (!host) {
    return null;
  }

  return {
    host,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
    username: process.env.CLICKHOUSE_USERNAME || process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || process.env.CLICKHOUSE_PASS || '',
  } as ClickHouseHostConfig;
}
