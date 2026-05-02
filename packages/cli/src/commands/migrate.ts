import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { loadMigrationJournal } from '../utils/migration-state.js';
import {
  hashContent,
  loadMigrationFilesBatch,
  quoteIdentifier,
  toClickHouseUrl,
  tryLoadAppliedMigrationStatuses,
  type LoadedMigrationFiles,
} from '../utils/migration-execution.js';

export interface MigrateOptions {
  config?: string;
}

const MIGRATION_BREAKPOINT = '-- hypequery:breakpoint';
const MUTATION_VERIFICATION_ATTEMPTS = 10;
const MUTATION_VERIFICATION_DELAY_MS = 25;

export async function migrateCommand(options: MigrateOptions = {}): Promise<void> {
  logger.command('migrate', 'Apply pending local migrations to ClickHouse and record applied state.');
  logger.phase('Loading migration state');

  const spinner = ora('Loading migration journal...').start();
  let client: ClickHouseClient | null = null;

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const metaDir = path.join(migrationsOutDir, 'meta');
    const journal = await loadMigrationJournal(metaDir);

    logger.phase('Connecting to ClickHouse');
    spinner.text = 'Connecting to ClickHouse...';
    client = createClient({
      url: toClickHouseUrl(config.dbCredentials),
      username: config.dbCredentials.username,
      password: config.dbCredentials.password ?? '',
      database: config.dbCredentials.database,
    });

    logger.phase('Bootstrapping migration table');
    spinner.text = 'Ensuring migration table exists...';
    await ensureMigrationTable(client, config.migrations.table);

    logger.phase('Verifying recorded migration state');
    spinner.text = 'Loading applied migration state...';
    const appliedByName = (await tryLoadAppliedMigrationStatuses(client, config.migrations.table)) ?? new Map();
    const localEntries = [...journal.migrations]
      .sort((left, right) => left.name.localeCompare(right.name));
    const localMigrations = await loadMigrationFilesBatch(migrationsOutDir, localEntries);

    const failedMigrations = localEntries.filter(entry => appliedByName.get(entry.name)?.status === 'failed');
    if (failedMigrations.length > 0) {
      spinner.fail('Migration state requires reconciliation');
      logger.callout('Reconciliation Required', [
        `${failedMigrations.length} recorded migration${failedMigrations.length === 1 ? '' : 's'} previously failed in ClickHouse.`,
        'Resolve the failed migration state before applying newer migrations.',
      ]);
      process.exit(1);
    }

    const driftedMigrations = localMigrations.filter(migration => {
      const applied = appliedByName.get(migration.migrationName);
      return applied?.status === 'completed' && applied.checksum !== migration.checksum;
    });
    if (driftedMigrations.length > 0) {
      spinner.fail('Migration checksum drift detected');
      logger.callout('Checksum Warning', [
        `${driftedMigrations.length} applied migration${driftedMigrations.length === 1 ? '' : 's'} no longer match the local files.`,
        'Restore the original files or reconcile ClickHouse before continuing.',
      ]);
      process.exit(1);
    }

    const pendingMigrations = localMigrations.filter(migration => appliedByName.get(migration.migrationName)?.status !== 'completed');

    if (pendingMigrations.length === 0) {
      spinner.succeed('No pending migrations');
      logger.callout('Up To Date', [
        'All locally tracked migrations are already recorded in ClickHouse.',
      ]);
      return;
    }

    logger.phase('Applying pending migrations');
    spinner.succeed(`Found ${pendingMigrations.length} pending migration${pendingMigrations.length === 1 ? '' : 's'}`);

    for (const migration of pendingMigrations) {
      await applyMigration(client, config.dbCredentials.database, config.migrations.table, migration);
    }

    logger.kv([
      ['applied', String(pendingMigrations.length)],
      ['table', config.migrations.table],
      ['database', config.dbCredentials.database],
    ]);
    logger.callout('Safety', [
      'ClickHouse migrations are non-transactional.',
      'If a future migration fails, reconcile any partial side effects before retrying.',
    ]);
  } catch (error) {
    spinner.fail('Failed to apply migrations');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  } finally {
    await client?.close().catch(() => undefined);
  }
}

async function ensureMigrationTable(client: ClickHouseClient, tableName: string): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
        id UUID,
        version UInt64,
        migration_name String,
        checksum String,
        type LowCardinality(String),
        started_at DateTime64(3),
        finished_at Nullable(DateTime64(3)),
        rolled_back_at Nullable(DateTime64(3)),
        applied_steps_count UInt32,
        total_steps UInt32,
        partial_hashes Array(String),
        status LowCardinality(String),
        error_message Nullable(String),
        error_stmt Nullable(String),
        execution_time_ms UInt64,
        applied_by String DEFAULT currentUser(),
        cluster Nullable(String),
        hypequery_version String
      )
      ENGINE = ReplacingMergeTree(started_at)
      ORDER BY (migration_name, id)
    `,
  });
}

async function applyMigration(
  client: ClickHouseClient,
  database: string,
  tableName: string,
  migration: LoadedMigrationFiles,
): Promise<void> {
  logger.reload(`Applying ${migration.migrationName}`);

  const statements = splitMigrationStatements(migration.upSql);
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const statementHashes: string[] = [];
  const started = Date.now();

  try {
    let appliedSteps = 0;

    for (const statement of statements) {
      statementHashes.push(hashContent(statement));
      await client.command({
        query: statement,
      });
      await verifyStatementEffects(client, database, statement);
      appliedSteps += 1;
    }

    const finishedAt = new Date();
    await insertMigrationRecord(client, tableName, {
      id: randomUUID(),
      version: Number(migration.migrationName.slice(0, 14)) || Date.now(),
      migrationName: migration.migrationName,
      checksum: migration.checksum,
      type: migration.kind,
      startedAt: startedAtIso,
      finishedAt: finishedAt.toISOString(),
      rolledBackAt: null,
      appliedStepsCount: statements.length,
      totalSteps: statements.length,
      partialHashes: statementHashes,
      status: 'completed',
      errorMessage: null,
      errorStmt: null,
      executionTimeMs: Date.now() - started,
      cluster: null,
      hypequeryVersion: '0.0.1',
    });

    logger.kv([
      ['migration', migration.migrationName],
      ['steps', `${statements.length}/${statements.length}`],
      ['checksum', migration.checksum.slice(0, 12)],
    ]);
  } catch (error) {
    const failedStatement = statementHashes.length < statements.length
      ? statements[statementHashes.length]
      : statements[statements.length - 1] ?? null;

    await insertMigrationRecord(client, tableName, {
      id: randomUUID(),
      version: Number(migration.migrationName.slice(0, 14)) || Date.now(),
      migrationName: migration.migrationName,
      checksum: migration.checksum,
      type: migration.kind,
      startedAt: startedAtIso,
      finishedAt: null,
      rolledBackAt: null,
      appliedStepsCount: statementHashes.length,
      totalSteps: statements.length,
      partialHashes: statementHashes,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStmt: failedStatement,
      executionTimeMs: Date.now() - started,
      cluster: null,
      hypequeryVersion: '0.0.1',
    });

    logger.callout('Reconciliation Required', [
      `Migration ${migration.migrationName} failed after ${statementHashes.length} of ${statements.length} step${statements.length === 1 ? '' : 's'}.`,
      'ClickHouse may already have partial side effects from earlier statements.',
    ]);
    throw error;
  }
}

async function insertMigrationRecord(
  client: ClickHouseClient,
  tableName: string,
  record: {
    id: string;
    version: number;
    migrationName: string;
    checksum: string;
    type: string;
    startedAt: string;
    finishedAt: string | null;
    rolledBackAt: string | null;
    appliedStepsCount: number;
    totalSteps: number;
    partialHashes: string[];
    status: string;
    errorMessage: string | null;
    errorStmt: string | null;
    executionTimeMs: number;
    cluster: string | null;
    hypequeryVersion: string;
  },
): Promise<void> {
  await client.insert({
    table: tableName,
    values: [{
      id: record.id,
      version: record.version,
      migration_name: record.migrationName,
      checksum: record.checksum,
      type: record.type,
      started_at: record.startedAt,
      finished_at: record.finishedAt,
      rolled_back_at: record.rolledBackAt,
      applied_steps_count: record.appliedStepsCount,
      total_steps: record.totalSteps,
      partial_hashes: record.partialHashes,
      status: record.status,
      error_message: record.errorMessage,
      error_stmt: record.errorStmt,
      execution_time_ms: record.executionTimeMs,
      cluster: record.cluster,
      hypequery_version: record.hypequeryVersion,
    }],
    format: 'JSONEachRow',
  });
}

async function verifyStatementEffects(
  client: ClickHouseClient,
  defaultDatabase: string,
  statement: string,
): Promise<void> {
  const mutationTargets = extractMutationVerificationTargets(statement, defaultDatabase);

  for (const target of mutationTargets) {
    await waitForMutationCompletion(client, target);
  }
}

async function waitForMutationCompletion(
  client: ClickHouseClient,
  target: { database: string; table: string },
): Promise<void> {
  for (let attempt = 0; attempt < MUTATION_VERIFICATION_ATTEMPTS; attempt += 1) {
    const result = await client.query({
      query: `
        SELECT
          is_done AS isDone,
          latest_fail_reason AS latestFailReason
        FROM system.mutations
        WHERE database = {database:String}
          AND table = {table:String}
        ORDER BY create_time DESC
      `,
      query_params: {
        database: target.database,
        table: target.table,
      },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as MutationStatusRow[];
    const failedRow = rows.find(row => Number(row.isDone) === 0 && row.latestFailReason);
    if (failedRow) {
      throw new Error(
        `Mutation verification failed for ${target.database}.${target.table}: ${failedRow.latestFailReason}`,
      );
    }

    const pendingRows = rows.filter(row => Number(row.isDone) === 0);
    if (pendingRows.length === 0) {
      return;
    }

    if (attempt < MUTATION_VERIFICATION_ATTEMPTS - 1) {
      await sleep(MUTATION_VERIFICATION_DELAY_MS);
    }
  }

  throw new Error(
    `Timed out waiting for mutations to finish on ${target.database}.${target.table}.`,
  );
}

interface MutationStatusRow {
  isDone: number | string;
  latestFailReason?: string | null;
}

function extractMutationVerificationTargets(
  statement: string,
  defaultDatabase: string,
): Array<{ database: string; table: string }> {
  const targets = new Map<string, { database: string; table: string }>();
  const pattern = /\b(?:ALTER|OPTIMIZE)\s+TABLE\s+([`"\w.]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(statement)) !== null) {
    const identifier = parseQualifiedIdentifier(match[1], defaultDatabase);
    if (!identifier) {
      continue;
    }

    targets.set(`${identifier.database}.${identifier.table}`, identifier);
  }

  return Array.from(targets.values());
}

function parseQualifiedIdentifier(
  input: string | undefined,
  defaultDatabase: string,
): { database: string; table: string } | null {
  if (!input) {
    return null;
  }

  const cleaned = input
    .trim()
    .replace(/^[`"]+|[`"]+$/g, '');

  if (!cleaned) {
    return null;
  }

  const parts = cleaned
    .split('.')
    .map(part => part.replace(/^[`"]+|[`"]+$/g, ''))
    .filter(Boolean);

  if (parts.length === 1) {
    return {
      database: defaultDatabase,
      table: parts[0],
    };
  }

  return {
    database: parts[0],
    table: parts[1],
  };
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

function splitMigrationStatements(sql: string): string[] {
  if (sql.includes(MIGRATION_BREAKPOINT)) {
    return sql
      .split(MIGRATION_BREAKPOINT)
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => part.endsWith(';') ? part : `${part};`);
  }

  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let previous = '';

  for (const char of sql) {
    current += char;

    if (char === '\'' && !inDoubleQuote && !inBacktick && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inBacktick && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && previous !== '\\') {
      inBacktick = !inBacktick;
    } else if (char === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = '';
    }

    previous = char;
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(trailing.endsWith(';') ? trailing : `${trailing};`);
  }

  return statements;
}
