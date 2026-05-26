import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrationFilesFixture } from '../test-utils.js';
import { writeMigrationChecksumFile } from './migration-checksums.js';
import { appendMigrationJournalEntry, initializeMigrationJournal } from './migration-state.js';
import {
  applyPendingMigrations,
  splitMigrationStatements,
  type MigrationExecutionClient,
} from './migration-execution.js';

let tempDir: string;
let previousCwd: string;

describe('migration execution', () => {
  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-execution-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('splits statements by explicit breakpoints', () => {
    expect(splitMigrationStatements([
      'CREATE TABLE events (id UInt64);',
      '-- hypequery:breakpoint',
      'ALTER TABLE events ADD COLUMN name String;',
    ].join('\n'))).toEqual([
      'CREATE TABLE events (id UInt64);',
      'ALTER TABLE events ADD COLUMN name String;',
    ]);
  });

  it('splits semicolons outside string literals', () => {
    expect(splitMigrationStatements("SELECT ';';\nSELECT 2;")).toEqual([
      "SELECT ';';",
      'SELECT 2;',
    ]);
  });

  it('skips comment-only statements', () => {
    expect(splitMigrationStatements([
      '-- Write custom migration SQL here.',
      '/* block comment with ; semicolon */',
    ].join('\n'))).toEqual([
    ]);
  });

  it('applies pending migrations and records execution rows', async () => {
    const name = '20260525120000_add_events';
    const migrationDir = await createMigrationFilesFixture(tempDir, name);
    const checksum = await writeMigrationChecksumFile(migrationDir);
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
      name,
      timestamp: '20260525120000',
      custom: false,
      sourceSnapshotHash: 'source',
      targetSnapshotHash: 'target',
      checksum: checksum.checksum,
    }, 'target');
    const command = vi.fn().mockResolvedValue(undefined);
    const client: MigrationExecutionClient = {
      command,
      query: vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    };

    await expect(applyPendingMigrations({
      migrationsOutDir: path.join(tempDir, 'migrations'),
      migrationTable: '_hypequery_migrations',
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      appliedUser: 'tester',
      client,
    })).resolves.toEqual([
      {
        name,
        state: 'applied',
        appliedStepCount: 1,
        totalSteps: 1,
      },
    ]);

    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining('CREATE TABLE IF NOT EXISTS `_hypequery_migrations`'),
    }));
    expect(command).toHaveBeenCalledWith({ query: 'SELECT 1;' });
    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("'applied'"),
    }));
  });

  it('rejects pending migrations when the journal checksum is stale', async () => {
    const name = '20260525120000_add_events';
    const migrationDir = await createMigrationFilesFixture(tempDir, name);
    await writeMigrationChecksumFile(migrationDir);
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
      name,
      timestamp: '20260525120000',
      custom: false,
      sourceSnapshotHash: 'source',
      targetSnapshotHash: 'target',
      checksum: 'stale',
    }, 'target');
    const client: MigrationExecutionClient = {
      command: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    };

    await expect(applyPendingMigrations({
      migrationsOutDir: path.join(tempDir, 'migrations'),
      migrationTable: '_hypequery_migrations',
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      client,
    })).rejects.toThrow('journal checksum mismatch');
  });

  it('records failed state with partial progress', async () => {
    const name = '20260525120000_add_events';
    const migrationDir = await createMigrationFilesFixture(tempDir, name);
    await writeFile(
      path.join(migrationDir, 'up.sql'),
      'SELECT 1;\nSELECT 2;\n',
      'utf8',
    );
    const checksum = await writeMigrationChecksumFile(migrationDir);
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
      name,
      timestamp: '20260525120000',
      custom: false,
      sourceSnapshotHash: 'source',
      targetSnapshotHash: 'target',
      checksum: checksum.checksum,
    }, 'target');
    const command = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const client: MigrationExecutionClient = {
      command,
      query: vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    };

    await expect(applyPendingMigrations({
      migrationsOutDir: path.join(tempDir, 'migrations'),
      migrationTable: '_hypequery_migrations',
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      client,
    })).rejects.toThrow('failed at statement 1/2');

    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("'failed'"),
    }));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining('boom'),
    }));
  });
});
