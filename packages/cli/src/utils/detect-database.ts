import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getClickHouseClient } from './clickhouse-client.js';
import { validateChdb, getChdbTables } from './chdb-client.js';

/**
 * Database type detection result
 */
export type DatabaseType = 'clickhouse' | 'chdb' | 'bigquery' | 'unknown';

/**
 * Options threaded through to drivers that need more than env vars —
 * currently only the embedded chDB session directory.
 */
export interface DatabaseOptions {
  chdbPath?: string;
}

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

  // A project that depends on chdb but has no ClickHouse connection config is
  // running on the embedded engine.
  try {
    const pkgContent = await readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.dependencies?.chdb || pkg.devDependencies?.chdb) {
      return 'chdb';
    }
  } catch {
    // package.json missing or unparsable, continue
  }

  return 'unknown';
}

/**
 * Validate database connection
 */
export async function validateConnection(
  dbType: DatabaseType,
  options: DatabaseOptions = {},
): Promise<boolean> {
  switch (dbType) {
    case 'clickhouse':
      return validateClickHouse();
    case 'chdb':
      return validateChdb(options.chdbPath);
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
export async function getTableCount(
  dbType: DatabaseType,
  options: DatabaseOptions = {},
): Promise<number> {
  switch (dbType) {
    case 'clickhouse':
      return getClickHouseTableCount();
    case 'chdb':
      return (await getChdbTables(options.chdbPath)).length;
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
export async function getTables(
  dbType: DatabaseType,
  options: DatabaseOptions = {},
): Promise<string[]> {
  switch (dbType) {
    case 'clickhouse':
      return getClickHouseTables();
    case 'chdb':
      return getChdbTables(options.chdbPath);
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
