import { access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Database type detection result
 */
export type DatabaseType = 'clickhouse' | 'bigquery' | 'postgres' | 'unknown';

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

  if (process.env.POSTGRES_URL || process.env.DATABASE_URL?.includes('postgres')) {
    return 'postgres';
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

    if (envContent.includes('POSTGRES_') || envContent.includes('DATABASE_URL')) {
      return 'postgres';
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
    case 'postgres':
      return validatePostgres();
    default:
      return false;
  }
}

async function validateClickHouse(): Promise<boolean> {
  try {
    const { ClickHouseConnection } = await import('@hypequery/clickhouse');
    const client = ClickHouseConnection.getClient();

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

async function validatePostgres(): Promise<boolean> {
  // TODO: Implement when Postgres support is added
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
    const { ClickHouseConnection } = await import('@hypequery/clickhouse');
    const client = ClickHouseConnection.getClient();

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
    const { ClickHouseConnection } = await import('@hypequery/clickhouse');
    const client = ClickHouseConnection.getClient();

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
