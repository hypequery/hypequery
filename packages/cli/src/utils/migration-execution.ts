import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClickHouseMigrationDbCredentials } from '@hypequery/schema';
import { createMigrationClickHouseClient } from './clickhouse-migration-introspection.js';
import { calculateMigrationChecksum, verifyMigrationIntegrity } from './migration-checksums.js';
import {
  ensureMigrationTable,
  fetchAppliedMigrations,
  insertMigrationExecutionRow,
  type MigrationExecutionClient,
} from './migration-remote-state.js';
import { hashStatement, splitMigrationStatements } from './migration-statements.js';
import { readMigrationJournal, type MigrationJournalEntry } from './migration-state.js';
import { sha256 } from './sha256.js';

export type { MigrationExecutionClient } from './migration-remote-state.js';
export { splitMigrationStatements } from './migration-statements.js';

export interface MigrationApplyResult {
  name: string;
  state: 'skipped' | 'applied';
  appliedStepCount: number;
  totalSteps: number;
}

export interface ApplyPendingMigrationsOptions {
  migrationsOutDir: string;
  migrationTable: string;
  credentials: ClickHouseMigrationDbCredentials;
  cluster?: string;
  appliedUser?: string;
  hypequeryVersion?: string;
  client?: MigrationExecutionClient;
}

const DEFAULT_HYPEQUERY_VERSION = '0.0.1';

export async function applyPendingMigrations(
  options: ApplyPendingMigrationsOptions,
): Promise<MigrationApplyResult[]> {
  const client = options.client ?? createMigrationClickHouseClient(options.credentials);
  const shouldClose = options.client === undefined;

  try {
    await ensureMigrationTable(client, options.migrationTable);
    await assertLocalMigrationIntegrity(options.migrationsOutDir);

    const journal = await readMigrationJournal(options.migrationsOutDir);
    const applied = await fetchAppliedMigrations({
      client,
      migrationTable: options.migrationTable,
    });
    const appliedByName = new Map(applied.filter(row => row.status === 'applied').map(row => [row.name, row]));
    const failed = applied.find(row => row.status === 'failed');
    if (failed) {
      throw new Error(
        `Remote migration state is dirty at ${failed.name}. ` +
        'Resolve the partial ClickHouse side effects manually before applying more migrations.',
      );
    }

    const results: MigrationApplyResult[] = [];
    for (let index = 0; index < journal.migrations.length; index += 1) {
      const entry = journal.migrations[index];
      const appliedEntry = appliedByName.get(entry.name);
      if (appliedEntry) {
        if (entry.checksum && appliedEntry.checksum !== entry.checksum) {
          throw new Error(
            `Applied migration checksum mismatch for ${entry.name}. ` +
            'The local migration files no longer match the checksum stored in ClickHouse.',
          );
        }
        results.push({
          name: entry.name,
          state: 'skipped',
          appliedStepCount: appliedEntry.appliedStepCount,
          totalSteps: appliedEntry.totalSteps,
        });
        continue;
      }

      results.push(await applyMigration({
        client,
        migrationsOutDir: options.migrationsOutDir,
        migrationTable: options.migrationTable,
        entry,
        version: index + 1,
        cluster: options.cluster,
        appliedUser: options.appliedUser ?? process.env.USER ?? process.env.USERNAME ?? 'unknown',
        hypequeryVersion: options.hypequeryVersion ?? DEFAULT_HYPEQUERY_VERSION,
      }));
    }

    return results;
  } finally {
    if (shouldClose) {
      await client.close?.();
    }
  }
}

async function assertLocalMigrationIntegrity(migrationsOutDir: string) {
  const integrity = await verifyMigrationIntegrity(migrationsOutDir);
  const failedIntegrity = integrity.filter(result => !result.ok);
  if (failedIntegrity.length > 0) {
    throw new Error(
      `Migration integrity check failed for ${failedIntegrity.map(result => result.migrationName).join(', ')}.`,
    );
  }
}

async function applyMigration(input: {
  client: MigrationExecutionClient;
  migrationsOutDir: string;
  migrationTable: string;
  entry: MigrationJournalEntry;
  version: number;
  cluster?: string;
  appliedUser: string;
  hypequeryVersion: string;
}): Promise<MigrationApplyResult> {
  const migrationDir = path.join(input.migrationsOutDir, input.entry.name);
  const checksumFile = await calculateMigrationChecksum(migrationDir);
  if (input.entry.checksum && input.entry.checksum !== checksumFile.checksum) {
    throw new Error(
      `Migration journal checksum mismatch for ${input.entry.name}. ` +
      'Run migrate:check and reconcile the local migration metadata before applying.',
    );
  }

  const upSql = await readFile(path.join(migrationDir, 'up.sql'), 'utf8');
  const statements = splitMigrationStatements(upSql);
  const statementHashes = statements.map(statement => hashStatement(statement));
  const startedAt = new Date();
  const executionId = sha256(`${input.entry.name}\0${startedAt.toISOString()}`);

  await insertMigrationExecutionRow({
    ...input,
    id: executionId,
    checksum: checksumFile.checksum,
    status: 'started',
    startedAt,
    finishedAt: null,
    appliedStepCount: 0,
    totalSteps: statements.length,
    statementHashes,
    executionTimeMs: 0,
  });

  const startMs = Date.now();
  let appliedStepCount = 0;
  try {
    for (const statement of statements) {
      await input.client.command({ query: statement });
      appliedStepCount += 1;
    }
  } catch (error) {
    await insertMigrationExecutionRow({
      ...input,
      id: executionId,
      checksum: checksumFile.checksum,
      status: 'failed',
      startedAt,
      finishedAt: new Date(),
      appliedStepCount,
      totalSteps: statements.length,
      statementHashes,
      errorStatement: statements[appliedStepCount],
      errorMessage: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startMs,
    });
    throw new Error(
      `Migration ${input.entry.name} failed at statement ${appliedStepCount + 1}/${statements.length}. ` +
      'ClickHouse DDL is not transactional; partial side effects may already exist.',
    );
  }

  await insertMigrationExecutionRow({
    ...input,
    id: executionId,
    checksum: checksumFile.checksum,
    status: 'applied',
    startedAt,
    finishedAt: new Date(),
    appliedStepCount,
    totalSteps: statements.length,
    statementHashes,
    executionTimeMs: Date.now() - startMs,
  });

  return {
    name: input.entry.name,
    state: 'applied',
    appliedStepCount,
    totalSteps: statements.length,
  };
}
