import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { introspectClickHouseSchema } from './clickhouse-migration-introspection.js';
import { createMigrationClickHouseClient } from './clickhouse-migration-introspection.js';
import { quoteIdentifier } from './clickhouse-sql.js';
import { verifyMigrationIntegrity } from './migration-checksums.js';
import { applyPendingMigrations } from './migration-execution.js';
import { fetchAppliedMigrations } from './migration-remote-state.js';
import {
  appendMigrationJournalEntry,
  getLocalMigrationStatuses,
  initializeMigrationJournal,
  readMigrationJournal,
  writeLatestMigrationSnapshot,
} from './migration-state.js';
import { writeSchemaFileFromSnapshot } from './migration-schema-emitter.js';
import { writeMigrationChecksumFile } from './migration-checksums.js';
import type { ClickHouseMigrationDbCredentials } from '@hypequery/schema';

describe('migration workflows integration', () => {
  const suffix = `${Date.now()}_${process.pid}`;
  let tempDir: string;
  let client: ReturnType<typeof createMigrationClickHouseClient>;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-workflows-'));
    client = createMigrationClickHouseClient(clickhouseCredentials());
    await client.ping();
  });

  afterAll(async () => {
    if (client) {
      await cleanupTables(client, suffix);
      await client.close();
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('pull/baseline workflow', () => {
    const baselineTable = `hq_baseline_test_${suffix}`;
    const baselineMV = `hq_baseline_mv_${suffix}`;
    const migrationTable = `_hq_migrations_baseline_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP VIEW IF EXISTS ${quoteIdentifier(baselineMV)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(baselineTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('introspects live schema and generates baseline files', async () => {
      // Create a table and materialized view
      await client.command({
        query: `CREATE TABLE ${quoteIdentifier(baselineTable)} (
          id UInt64,
          name String,
          created_at DateTime
        ) ENGINE = MergeTree
        ORDER BY id`,
      });

      await client.command({
        query: `CREATE MATERIALIZED VIEW ${quoteIdentifier(baselineMV)}
        ENGINE = MergeTree
        ORDER BY id
        AS SELECT id, name FROM ${quoteIdentifier(baselineTable)}`,
      });

      // Introspect the schema
      const snapshot = await introspectClickHouseSchema({
        credentials: clickhouseCredentials(),
        includeTables: [baselineTable, baselineMV],
      });

      expect(snapshot.tables).toHaveLength(1);
      const table = snapshot.tables.find(t => t.name === baselineTable);

      expect(table).toBeDefined();
      expect(table?.columns).toHaveLength(3);
      expect(table?.columns.map(c => c.name)).toEqual(['id', 'name', 'created_at']);

      expect(snapshot.materializedViews).toHaveLength(1);
      const mv = snapshot.materializedViews.find(v => v.name === baselineMV);
      expect(mv).toBeDefined();
      expect(mv?.from).toBe(baselineTable);
      expect(mv?.engine).toContain('MergeTree');

      // Write baseline files
      const migrationsOutDir = path.join(tempDir, 'baseline');
      const schemaPath = path.join(migrationsOutDir, 'schema.ts');

      await writeSchemaFileFromSnapshot({
        snapshot,
        outputPath: schemaPath,
      });

      await writeLatestMigrationSnapshot(migrationsOutDir, snapshot);
      await initializeMigrationJournal(migrationsOutDir, snapshot.contentHash);

      // Verify files were created
      const journal = await readMigrationJournal(migrationsOutDir);
      expect(journal.migrations).toHaveLength(0);
      expect(journal.latestSnapshotHash).toBe(snapshot.contentHash);
    });
  });

  describe('status workflow', () => {
    const statusTable = `hq_status_test_${suffix}`;
    const migrationTable = `_hq_migrations_status_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(statusTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('reports applied, pending, and dirty migration states', async () => {
      const migrationsOutDir = path.join(tempDir, 'status');

      // Create three migrations
      const appliedMigration = '20260527100000_applied';
      const pendingMigration = '20260527110000_pending';
      const dirtyMigration = '20260527120000_dirty';

      // Write the applied migration
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: appliedMigration,
        upSql: `CREATE TABLE ${quoteIdentifier(statusTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;`,
      });

      // Apply it
      await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      // Write the pending migration
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: pendingMigration,
        upSql: `ALTER TABLE ${quoteIdentifier(statusTable)} ADD COLUMN name String;`,
      });

      // Write the dirty migration (will fail)
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: dirtyMigration,
        upSql: [
          `ALTER TABLE ${quoteIdentifier(statusTable)} ADD COLUMN age UInt8;`,
          '-- hypequery:breakpoint',
          `ALTER TABLE ${quoteIdentifier(statusTable)} ADD COLUMN id UInt64;`, // duplicate column
        ].join('\n'),
      });

      // Try to apply remaining migrations (dirty will fail)
      await expect(applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      })).rejects.toThrow();

      // Check remote state
      const appliedRecords = await fetchAppliedMigrations({ client, migrationTable });
      const statuses = await getLocalMigrationStatuses(migrationsOutDir, appliedRecords);

      expect(statuses).toHaveLength(3);

      const applied = statuses.find(s => s.name === appliedMigration);
      expect(applied?.state).toBe('applied');
      expect(applied?.remoteChecksum).toBe(applied?.checksum);

      const pending = statuses.find(s => s.name === pendingMigration);
      expect(pending?.state).toBe('pending');
      expect(pending?.remoteChecksum).toBeUndefined();

      const dirty = statuses.find(s => s.name === dirtyMigration);
      expect(dirty?.state).toBe('dirty');
      expect(dirty?.progress).toContain('1/2');
    });
  });

  describe('check workflow', () => {
    const checkTable = `hq_check_test_${suffix}`;
    const migrationTable = `_hq_migrations_check_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(checkTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('detects checksum mismatches between local and remote', async () => {
      const migrationsOutDir = path.join(tempDir, 'check');
      const migrationName = '20260527130000_check_test';

      await writeMigrationFixture({
        migrationsOutDir,
        migrationName,
        upSql: `CREATE TABLE ${quoteIdentifier(checkTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;`,
      });

      // Apply the migration
      await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      // Verify checksums match
      const results = await verifyMigrationIntegrity(migrationsOutDir);
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(true);

      const journal = await readMigrationJournal(migrationsOutDir);
      const appliedRecords = await fetchAppliedMigrations({ client, migrationTable });

      const localEntry = journal.migrations.find(m => m.name === migrationName);
      const remoteEntry = appliedRecords.find(m => m.name === migrationName);

      expect(localEntry?.checksum).toBe(remoteEntry?.checksum);

      // Modify the local migration file to create a mismatch
      const migrationDir = path.join(migrationsOutDir, migrationName);
      await writeFile(
        path.join(migrationDir, 'up.sql'),
        `-- modified\nCREATE TABLE ${quoteIdentifier(checkTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;\n`,
        'utf8'
      );

      // Verify checksum mismatch is detected
      const modifiedResults = await verifyMigrationIntegrity(migrationsOutDir);
      expect(modifiedResults[0].ok).toBe(false);
      expect(modifiedResults[0].changedFiles).toContain('up.sql');
    });
  });

  describe('multi-migration ordering', () => {
    const orderTable = `hq_order_test_${suffix}`;
    const migrationTable = `_hq_migrations_order_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(orderTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('applies multiple pending migrations in timestamp order', async () => {
      const migrationsOutDir = path.join(tempDir, 'ordering');

      // Write migrations in non-chronological order (by creation time)
      const migration1 = '20260527140000_first';
      const migration2 = '20260527140100_second';
      const migration3 = '20260527140200_third';

      // Write migration3 first
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration3,
        upSql: `ALTER TABLE ${quoteIdentifier(orderTable)} ADD COLUMN third String;`,
      });

      // Then migration1
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration1,
        upSql: `CREATE TABLE ${quoteIdentifier(orderTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;`,
      });

      // Finally migration2
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration2,
        upSql: `ALTER TABLE ${quoteIdentifier(orderTable)} ADD COLUMN second String;`,
      });

      // Apply all migrations
      const results = await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      // Verify they were applied in timestamp order
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe(migration1);
      expect(results[1].name).toBe(migration2);
      expect(results[2].name).toBe(migration3);

      // Verify table was created correctly
      const tableExists = await client.query({
        query: `SELECT name FROM system.tables WHERE database = currentDatabase() AND name = '${orderTable}'`,
        format: 'JSONEachRow',
      });
      const rows = await tableExists.json<{ name: string }>();
      expect(rows).toHaveLength(1);

      // Verify columns were added in order
      const columns = await client.query({
        query: `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${orderTable}' ORDER BY position`,
        format: 'JSONEachRow',
      });
      const columnRows = await columns.json<{ name: string }>();
      expect(columnRows.map(r => r.name)).toEqual(['id', 'second', 'third']);
    });
  });

  describe('idempotency', () => {
    const idempotentTable = `hq_idempotent_${suffix}`;
    const migrationTable = `_hq_migrations_idempotent_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(idempotentTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('reports no pending migrations on second deploy', async () => {
      const migrationsOutDir = path.join(tempDir, 'idempotent');
      const migrationName = '20260527150000_idempotent';

      await writeMigrationFixture({
        migrationsOutDir,
        migrationName,
        upSql: `CREATE TABLE ${quoteIdentifier(idempotentTable)} (id UInt64) ENGINE = MergeTree ORDER BY id;`,
      });

      // First apply
      const firstResults = await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      expect(firstResults).toHaveLength(1);
      expect(firstResults[0].name).toBe(migrationName);
      expect(firstResults[0].state).toBe('applied');

      // Second apply - should find nothing pending
      const secondResults = await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      expect(secondResults).toHaveLength(0);

      // Verify remote state shows migration as applied
      const appliedRecords = await fetchAppliedMigrations({ client, migrationTable });
      const applied = appliedRecords.find(m => m.name === migrationName);
      expect(applied?.status).toBe('applied');
      expect(applied?.appliedStepCount).toBe(applied?.totalSteps);
    });
  });

  describe('materialized view sequencing', () => {
    const mvSourceTable = `hq_mv_source_${suffix}`;
    const mvViewName = `hq_mv_view_${suffix}`;
    const migrationTable = `_hq_migrations_mv_${suffix}`;

    afterAll(async () => {
      await client.command({ query: `DROP VIEW IF EXISTS ${quoteIdentifier(mvViewName)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(mvSourceTable)}` }).catch(ignoreError);
      await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(migrationTable)}` }).catch(ignoreError);
    });

    it('handles MV drop/recreate when altering source table', async () => {
      const migrationsOutDir = path.join(tempDir, 'mv_sequence');

      // Migration 1: Create source table
      const migration1 = '20260527160000_create_source';
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration1,
        upSql: `CREATE TABLE ${quoteIdentifier(mvSourceTable)} (
          id UInt64,
          name String
        ) ENGINE = MergeTree ORDER BY id;`,
      });

      // Migration 2: Create materialized view
      const migration2 = '20260527160100_create_mv';
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration2,
        upSql: `CREATE MATERIALIZED VIEW ${quoteIdentifier(mvViewName)}
        ENGINE = MergeTree ORDER BY id
        AS SELECT id, name FROM ${quoteIdentifier(mvSourceTable)};`,
      });

      // Migration 3: Alter source table (requires MV drop/recreate)
      const migration3 = '20260527160200_alter_source_with_mv';
      await writeMigrationFixture({
        migrationsOutDir,
        migrationName: migration3,
        upSql: [
          `-- Drop dependent materialized view`,
          `DROP VIEW ${quoteIdentifier(mvViewName)};`,
          '-- hypequery:breakpoint',
          `-- Alter source table`,
          `ALTER TABLE ${quoteIdentifier(mvSourceTable)} ADD COLUMN age UInt8;`,
          '-- hypequery:breakpoint',
          `-- Recreate materialized view with new column`,
          `CREATE MATERIALIZED VIEW ${quoteIdentifier(mvViewName)}`,
          `ENGINE = MergeTree ORDER BY id`,
          `AS SELECT id, name, age FROM ${quoteIdentifier(mvSourceTable)};`,
        ].join('\n'),
      });

      // Apply all migrations
      const results = await applyPendingMigrations({
        migrationsOutDir,
        migrationTable,
        credentials: clickhouseCredentials(),
        appliedUser: 'integration-test',
      });

      expect(results).toHaveLength(3);
      expect(results.every(r => r.state === 'applied')).toBe(true);

      // Verify the MV exists and has the new column
      const mvQuery = await client.query({
        query: `SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = '${mvViewName}'`,
        format: 'JSONEachRow',
      });
      const mvRows = await mvQuery.json<{ create_table_query: string }>();
      expect(mvRows[0].create_table_query).toContain('age');

      // Verify source table has new column
      const columnsQuery = await client.query({
        query: `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${mvSourceTable}' ORDER BY position`,
        format: 'JSONEachRow',
      });
      const columnRows = await columnsQuery.json<{ name: string }>();
      expect(columnRows.map(r => r.name)).toEqual(['id', 'name', 'age']);
    });
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

  // Initialize or read existing journal
  try {
    await initializeMigrationJournal(input.migrationsOutDir, 'source-snapshot');
  } catch {
    // Journal already exists
  }

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

async function cleanupTables(client: ReturnType<typeof createMigrationClickHouseClient>, suffix: string) {
  const tablesQuery = await client.query({
    query: `SELECT name FROM system.tables WHERE database = currentDatabase() AND name LIKE '%${suffix}%'`,
    format: 'JSONEachRow',
  });
  const tables = await tablesQuery.json<{ name: string }>();

  for (const table of tables) {
    await client.command({ query: `DROP TABLE IF EXISTS ${quoteIdentifier(table.name)}` }).catch(ignoreError);
  }

  // Also clean up any views
  const viewsQuery = await client.query({
    query: `SELECT name FROM system.tables WHERE database = currentDatabase() AND engine LIKE '%View%' AND name LIKE '%${suffix}%'`,
    format: 'JSONEachRow',
  });
  const views = await viewsQuery.json<{ name: string }>();

  for (const view of views) {
    await client.command({ query: `DROP VIEW IF EXISTS ${quoteIdentifier(view.name)}` }).catch(ignoreError);
  }
}

function ignoreError(error: unknown) {
  void error;
}
