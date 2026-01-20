import { access } from 'node:fs/promises';
import path from 'node:path';
import { getClickHouseClient } from './clickhouse-client.js';

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
    const client = getClickHouseClient();

    const result = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    });

    await result.json();
    return true;
  } catch {
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

/**
 * Generic helper to execute ClickHouse queries with consistent error handling
 */
async function executeClickHouseQuery<T>(query: string, defaultValue: T): Promise<T> {
  try {
    const client = getClickHouseClient();

    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });

    return (await result.json()) as T;
  } catch {
    return defaultValue;
  }
}

async function getClickHouseTableCount(): Promise<number> {
  const tables = await executeClickHouseQuery<unknown[]>('SHOW TABLES', []);
  return Array.isArray(tables) ? tables.length : 0;
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
  const tables = await executeClickHouseQuery<Array<{ name: string }>>(
    'SHOW TABLES',
    []
  );
  return tables.map(t => t.name);
}
