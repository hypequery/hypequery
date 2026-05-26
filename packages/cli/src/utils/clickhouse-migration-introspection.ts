import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { ClickHouseMigrationDbCredentials, Snapshot, SnapshotColumn, SnapshotTable } from '@hypequery/schema';
import { hashSnapshot } from '@hypequery/schema';
import { sqlString } from './clickhouse-sql.js';
import { splitTopLevelArgs } from './clickhouse-type-utils.js';

export interface IntrospectClickHouseSchemaOptions {
  credentials: ClickHouseMigrationDbCredentials;
  client?: Pick<ClickHouseClient, 'query' | 'close'>;
  includeTables?: string[];
  excludeTables?: string[];
}

interface SystemTableRow {
  name: string;
  engine: string;
  engine_full: string;
  sorting_key: string;
  primary_key: string;
  partition_key: string;
}

interface SystemColumnRow {
  table: string;
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  position: number;
}

export async function introspectClickHouseSchema(
  options: IntrospectClickHouseSchemaOptions,
): Promise<Snapshot> {
  const client = options.client ?? createMigrationClickHouseClient(options.credentials);
  const shouldClose = options.client === undefined;

  try {
    const [tables, columns] = await Promise.all([
      fetchTables(client, options),
      fetchColumns(client, options.credentials.database),
    ]);
    const selectedTableNames = new Set(tables.map(table => table.name));
    const columnsByTable = groupColumnsByTable(columns.filter(column => selectedTableNames.has(column.table)));

    const snapshotWithoutHash = {
      version: 1 as const,
      dialect: 'clickhouse' as const,
      tables: tables.map((table): SnapshotTable => ({
        name: table.name,
        columns: columnsByTable.get(table.name) ?? [],
        engine: {
          type: table.engine,
          orderBy: parseKeyExpressionList(table.sorting_key),
          primaryKey: parseKeyExpressionList(table.primary_key),
          ...(table.partition_key ? { partitionBy: table.partition_key } : {}),
        },
        settings: parseEngineSettings(table.engine_full),
      })),
      materializedViews: [],
      dependencies: [],
    };

    return {
      ...snapshotWithoutHash,
      contentHash: hashSnapshot(snapshotWithoutHash),
    };
  } finally {
    if (shouldClose) {
      await client.close();
    }
  }
}

export function createMigrationClickHouseClient(
  credentials: ClickHouseMigrationDbCredentials,
): ClickHouseClient {
  return createClient({
    url: formatClickHouseUrl(credentials),
    username: credentials.username,
    password: credentials.password ?? '',
    database: credentials.database,
  });
}

function formatClickHouseUrl(credentials: ClickHouseMigrationDbCredentials) {
  if (/^https?:\/\//i.test(credentials.host)) {
    return credentials.host;
  }

  const protocol = credentials.secure ? 'https' : 'http';
  const port = credentials.port === undefined ? '' : `:${credentials.port}`;
  return `${protocol}://${credentials.host}${port}`;
}

async function fetchTables(
  client: Pick<ClickHouseClient, 'query'>,
  options: IntrospectClickHouseSchemaOptions,
): Promise<SystemTableRow[]> {
  const result = await client.query({
    query: [
      'SELECT name, engine, engine_full, sorting_key, primary_key, partition_key',
      'FROM system.tables',
      `WHERE database = ${sqlString(options.credentials.database)}`,
      "AND engine != 'MaterializedView'",
      'ORDER BY name',
    ].join('\n'),
    format: 'JSONEachRow',
  });
  const rows = await result.json<SystemTableRow>();

  return rows.filter(table => {
    if (options.includeTables?.length && !options.includeTables.includes(table.name)) {
      return false;
    }
    if (options.excludeTables?.length && options.excludeTables.includes(table.name)) {
      return false;
    }
    return true;
  });
}

async function fetchColumns(
  client: Pick<ClickHouseClient, 'query'>,
  database: string,
): Promise<SystemColumnRow[]> {
  const result = await client.query({
    query: [
      'SELECT table, name, type, default_kind, default_expression, position',
      'FROM system.columns',
      `WHERE database = ${sqlString(database)}`,
      'ORDER BY table, position',
    ].join('\n'),
    format: 'JSONEachRow',
  });

  return result.json<SystemColumnRow>();
}

function groupColumnsByTable(columns: SystemColumnRow[]) {
  const grouped = new Map<string, SnapshotColumn[]>();

  for (const column of columns) {
    const snapshotColumn: SnapshotColumn = {
      name: column.name,
      type: column.type,
      ...(column.default_expression
        ? {
            default: {
              kind: 'sql' as const,
              value: column.default_expression,
            },
          }
        : {}),
    };
    const tableColumns = grouped.get(column.table) ?? [];
    tableColumns.push(snapshotColumn);
    grouped.set(column.table, tableColumns);
  }

  return grouped;
}

function parseKeyExpressionList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'tuple()') {
    return [];
  }

  if (trimmed.startsWith('tuple(') && trimmed.endsWith(')')) {
    return splitTopLevelArgs(trimmed.slice('tuple('.length, -1));
  }

  return splitTopLevelArgs(trimmed);
}

function parseEngineSettings(engineFull: string): Record<string, string> {
  const settingsIndex = engineFull.indexOf(' SETTINGS ');
  if (settingsIndex === -1) {
    return {};
  }

  const settingsClause = engineFull.slice(settingsIndex + ' SETTINGS '.length).trim();
  return Object.fromEntries(
    splitTopLevelArgs(settingsClause)
      .map(setting => setting.split(/\s*=\s*/, 2))
      .filter((entry): entry is [string, string] => entry.length === 2 && entry[0].length > 0),
  );
}
