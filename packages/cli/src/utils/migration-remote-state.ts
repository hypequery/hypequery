import type { MigrationJournalEntry } from './migration-state.js';
import {
  assertValidIdentifier,
  quoteIdentifier,
  sqlDateTime,
  sqlString,
  sqlStringArray,
} from './clickhouse-sql.js';
import { isRecord } from './runtime-guards.js';

export interface MigrationExecutionClient {
  command(input: { query: string }): Promise<unknown>;
  query(input: { query: string; format: 'JSONEachRow' }): Promise<{ json<T>(): Promise<T[]> }>;
  close?(): Promise<void>;
}

export interface AppliedMigrationRecord {
  name: string;
  checksum: string;
  status: 'started' | 'applied' | 'failed';
  appliedStepCount: number;
  totalSteps: number;
  errorStatement?: string;
  errorMessage?: string;
}

export interface InsertMigrationExecutionRowInput {
  client: Pick<MigrationExecutionClient, 'command'>;
  migrationTable: string;
  id: string;
  version: number;
  entry: MigrationJournalEntry;
  checksum: string;
  status: 'started' | 'applied' | 'failed';
  startedAt: Date;
  finishedAt: Date | null;
  appliedStepCount: number;
  totalSteps: number;
  statementHashes: string[];
  errorStatement?: string;
  errorMessage?: string;
  executionTimeMs: number;
  appliedUser: string;
  cluster?: string;
  hypequeryVersion: string;
}

interface MigrationExecutionRow {
  name: string;
  checksum: string;
  status: string;
  applied_step_count: number | string;
  total_steps: number | string;
  error_statement: string | null;
  error_message: string | null;
}

interface MigrationTableExistsRow {
  name: string;
}

export async function ensureMigrationTable(
  client: Pick<MigrationExecutionClient, 'command'>,
  migrationTable: string,
) {
  await client.command({
    query: [
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(migrationTable)} (`,
      '  id String,',
      '  version UInt64,',
      '  name String,',
      '  checksum String,',
      '  type LowCardinality(String),',
      '  started_at DateTime64(3),',
      '  finished_at Nullable(DateTime64(3)),',
      '  rolled_back_at Nullable(DateTime64(3)),',
      '  applied_step_count UInt32,',
      '  total_steps UInt32,',
      '  statement_hashes Array(String),',
      '  status LowCardinality(String),',
      '  error_statement Nullable(String),',
      '  error_message Nullable(String),',
      '  execution_time_ms UInt64,',
      '  applied_user String,',
      '  cluster Nullable(String),',
      '  hypequery_version String',
      ')',
      'ENGINE = MergeTree',
      'ORDER BY (version, name, started_at, status)',
    ].join('\n'),
  });
}

export async function fetchAppliedMigrations(options: {
  client: Pick<MigrationExecutionClient, 'query'>;
  migrationTable: string;
}): Promise<AppliedMigrationRecord[]> {
  const result = await options.client.query({
    query: [
      'SELECT name, checksum, status, applied_step_count, total_steps, error_statement, error_message',
      `FROM ${quoteIdentifier(options.migrationTable)}`,
      "WHERE status IN ('applied', 'failed')",
      'ORDER BY version, started_at',
    ].join('\n'),
    format: 'JSONEachRow',
  });
  const rows = await result.json<MigrationExecutionRow>();

  return rows
    .filter(isMigrationExecutionRow)
    .map(row => ({
      name: row.name,
      checksum: row.checksum,
      status: row.status,
      appliedStepCount: Number(row.applied_step_count),
      totalSteps: Number(row.total_steps),
      ...(row.error_statement ? { errorStatement: row.error_statement } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
    }));
}

export async function fetchAppliedMigrationsIfTableExists(options: {
  client: Pick<MigrationExecutionClient, 'query'>;
  migrationTable: string;
}): Promise<AppliedMigrationRecord[]> {
  if (!await migrationTableExists(options.client, options.migrationTable)) {
    return [];
  }

  return fetchAppliedMigrations(options);
}

export async function migrationTableExists(
  client: Pick<MigrationExecutionClient, 'query'>,
  migrationTable: string,
) {
  assertValidIdentifier(migrationTable);
  const result = await client.query({
    query: [
      'SELECT name',
      'FROM system.tables',
      'WHERE database = currentDatabase()',
      `AND name = ${sqlString(migrationTable)}`,
      'LIMIT 1',
    ].join('\n'),
    format: 'JSONEachRow',
  });
  const rows = await result.json<MigrationTableExistsRow>();
  return rows.length > 0;
}

export async function insertMigrationExecutionRow(input: InsertMigrationExecutionRowInput) {
  await input.client.command({
    query: [
      `INSERT INTO ${quoteIdentifier(input.migrationTable)}`,
      '(',
      '  id, version, name, checksum, type, started_at, finished_at, rolled_back_at,',
      '  applied_step_count, total_steps, statement_hashes, status, error_statement,',
      '  error_message, execution_time_ms, applied_user, cluster, hypequery_version',
      ')',
      'VALUES (',
      [
        sqlString(input.id),
        String(input.version),
        sqlString(input.entry.name),
        sqlString(input.checksum),
        sqlString(input.entry.custom ? 'custom' : 'generated'),
        sqlDateTime(input.startedAt),
        input.finishedAt ? sqlDateTime(input.finishedAt) : 'NULL',
        'NULL',
        String(input.appliedStepCount),
        String(input.totalSteps),
        sqlStringArray(input.statementHashes),
        sqlString(input.status),
        input.errorStatement ? sqlString(input.errorStatement) : 'NULL',
        input.errorMessage ? sqlString(input.errorMessage) : 'NULL',
        String(input.executionTimeMs),
        sqlString(input.appliedUser),
        input.cluster ? sqlString(input.cluster) : 'NULL',
        sqlString(input.hypequeryVersion),
      ].join(', '),
      ')',
    ].join('\n'),
  });
}

function isMigrationExecutionRow(value: MigrationExecutionRow): value is MigrationExecutionRow & {
  status: AppliedMigrationRecord['status'];
} {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.checksum === 'string' &&
    (value.status === 'started' || value.status === 'applied' || value.status === 'failed');
}
