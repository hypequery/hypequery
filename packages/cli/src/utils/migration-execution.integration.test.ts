import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPendingMigrations } from './migration-execution.js';
import { fetchAppliedMigrations } from './migration-remote-state.js';
import { createMigrationClickHouseClient } from './clickhouse-migration-introspection.js';
import { writeMigrationChecksumFile } from './migration-checksums.js';
import {
  appendMigrationJournalEntry,
  initializeMigrationJournal,
} from './migration-state.js';
import { quoteIdentifier } from './clickhouse-sql.js';
import type { ClickHouseMigrationDbCredentials } from '@hypequery/schema';

const shouldSkipIntegration = process.env.SKIP_INTEGRATION_TESTS === 'true' ||
  (!process.env.CLICKHOUSE_TEST_HOST && !process.env.CLICKHOUSE_URL);

const testSuite = shouldSkipIntegration ? describe.skip : describe;

testSuite('migration execution integration', () => {
  const suffix = `${Date.now()}_${process.pid}`;
  const migrationTable = `_hq_migrations_${suffix}`;
  const successTable = `hq_migration_success_${suffix}`;
  const failedTable = `hq_migration_failed_${suffix}`;
  let tempDir: string;
  let client: ReturnType<typeof createMigrationClickHouseClient>;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-migrations-live-'));
    client = createMigrationClickHouseClient(clickhouseCredentials());
    await client.ping();
  });

  afterAll(async () => {
    if (client) {
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(successTable)}` }).catch(ignoreCleanupError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(failedTable)}` }).catch(ignoreCleanupError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreCleanupError);
      await client.close();
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('applies and records a migration against ClickHouse', async () => {
    const migrationsOutDir = path.join(tempDir, 'success');
    const migrationName = '20260526120000_create_success_table';
    await writeMigrationFixture({
      migrationsOutDir,
      migrationName,
      upSql: [
        `CREATE TABLE ${quoteIdentifier(successTable)} (id UInt64, name String) ENGINE = MergeTree ORDER BY id;`,
        '-- hypequery:breakpoint',
        `INSERT INTO ${quoteIdentifier(successTable)} VALUES (1, 'ok');`,
      ].join('\n'),
    });

    await expect(applyPendingMigrations({
      migrationsOutDir,
      migrationTable,
      credentials: clickhouseCredentials(),
      appliedUser: 'integration-test',
    })).resolves.toEqual([
      {
        name: migrationName,
        state: 'applied',
        appliedStepCount: 2,
        totalSteps: 2,
      },
    ]);

    const countResult = await client.query({
      query: `SELECT count() AS count FROM ${quoteIdentifier(successTable)}`,
      format: 'JSONEachRow',
    });
    const countRows = await countResult.json<{ count: string | number }>();
    expect(Number(countRows[0].count)).toBe(1);

    const applied = await fetchAppliedMigrations({ client, migrationTable });
    expect(applied).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: migrationName,
        status: 'applied',
        appliedStepCount: 2,
        totalSteps: 2,
      }),
    ]));
  });

  it('records dirty state after a real ClickHouse statement failure', async () => {
    const migrationsOutDir = path.join(tempDir, 'failure');
    const migrationName = '20260526120500_fail_after_create';
    await writeMigrationFixture({
      migrationsOutDir,
      migrationName,
      upSql: [
        `CREATE TABLE ${quoteIdentifier(failedTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;`,
        '-- hypequery:breakpoint',
        `ALTER TABLE ${quoteIdentifier(failedTable)} ADD COLUMN id UInt64;`,
      ].join('\n'),
    });

    await expect(applyPendingMigrations({
      migrationsOutDir,
      migrationTable,
      credentials: clickhouseCredentials(),
      appliedUser: 'integration-test',
    })).rejects.toThrow('failed at statement 2/2');

    const applied = await fetchAppliedMigrations({ client, migrationTable });
    expect(applied).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: migrationName,
        status: 'failed',
        appliedStepCount: 1,
        totalSteps: 2,
      }),
    ]));

    await expect(applyPendingMigrations({
      migrationsOutDir,
      migrationTable,
      credentials: clickhouseCredentials(),
      appliedUser: 'integration-test',
    })).rejects.toThrow('Remote migration state is dirty');
  });
});

async function writeMigrationFixture(input: {
  migrationsOutDir: string;
  migrationName: string;
  upSql: string;
}) {
  const migrationDir = path.join(input.migrationsOutDir, input.migrationName);
  await mkdir(migrationDir, { recursive: true });
  await writeFile(path.join(migrationDir, 'up.sql'), `${input.upSql}\n`, 'utf8');
  await writeFile(path.join(migrationDir, 'down.sql'), '-- no down migration\n', 'utf8');
  await writeFile(path.join(migrationDir, 'meta.json'), '{}\n', 'utf8');
  await writeFile(path.join(migrationDir, 'plan.json'), '{}\n', 'utf8');

  const checksum = await writeMigrationChecksumFile(migrationDir);
  await initializeMigrationJournal(input.migrationsOutDir, 'source-snapshot');
  await appendMigrationJournalEntry(input.migrationsOutDir, {
    name: input.migrationName,
    timestamp: input.migrationName.slice(0, 14),
    custom: false,
    sourceSnapshotHash: 'source-snapshot',
    targetSnapshotHash: 'target-snapshot',
    checksum: checksum.checksum,
  }, 'target-snapshot');
}

function clickhouseCredentials(): ClickHouseMigrationDbCredentials {
  return {
    host: process.env.CLICKHOUSE_TEST_HOST ?? process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_TEST_USER ?? process.env.CLICKHOUSE_USERNAME ?? 'default',
    password: process.env.CLICKHOUSE_TEST_PASSWORD ?? process.env.CLICKHOUSE_PASSWORD ?? '',
    database: process.env.CLICKHOUSE_TEST_DB ?? process.env.CLICKHOUSE_DATABASE ?? 'default',
  };
}

function ignoreCleanupError(error: unknown) {
  void error;
}
