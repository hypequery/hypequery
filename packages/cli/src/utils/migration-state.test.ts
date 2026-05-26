import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getLocalMigrationStatuses,
  initializeMigrationJournal,
  appendMigrationJournalEntry,
} from './migration-state.js';
import {
  calculateMigrationChecksum,
  verifyMigrationIntegrity,
  writeMigrationChecksumFile,
} from './migration-checksums.js';
import { createMigrationFilesFixture } from '../test-utils.js';

let tempDir: string;
let previousCwd: string;

describe('migration-state checksums', () => {
  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-state-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes and verifies a migration checksum file', async () => {
    const migrationDir = await createMigrationDir('20260525120000_add_events');

    const checksumFile = await writeMigrationChecksumFile(migrationDir);
    const written = JSON.parse(await readFile(path.join(migrationDir, 'hypequery.sum'), 'utf8'));
    const results = await verifyMigrationIntegrity(path.join(tempDir, 'migrations'));

    expect(written.checksum).toEqual(checksumFile.checksum);
    expect(Object.keys(written.files).sort()).toEqual(['down.sql', 'meta.json', 'plan.json', 'up.sql']);
    expect(results).toEqual([
      expect.objectContaining({
        migrationName: '20260525120000_add_events',
        ok: true,
        missingChecksumFile: false,
      }),
    ]);
  });

  it('detects changed migration files', async () => {
    const migrationDir = await createMigrationDir('20260525120000_add_events');
    await writeMigrationChecksumFile(migrationDir);
    await writeFile(path.join(migrationDir, 'up.sql'), 'SELECT 2;\n', 'utf8');

    const results = await verifyMigrationIntegrity(path.join(tempDir, 'migrations'));

    expect(results).toEqual([
      expect.objectContaining({
        ok: false,
        changedFiles: ['up.sql'],
      }),
    ]);
  });

  it('reports local journal migrations as pending with checksum status', async () => {
    const migrationDir = await createMigrationDir('20260525120000_add_events');
    const checksumFile = await writeMigrationChecksumFile(migrationDir);
    await initializeMigrationJournal(path.join(tempDir, 'migrations'), 'snapshot-hash');
    await appendMigrationJournalEntry(path.join(tempDir, 'migrations'), {
      name: '20260525120000_add_events',
      timestamp: '20260525120000',
      custom: false,
      sourceSnapshotHash: 'source',
      targetSnapshotHash: 'target',
      checksum: checksumFile.checksum,
    }, 'target');

    await expect(getLocalMigrationStatuses(path.join(tempDir, 'migrations'))).resolves.toEqual([
      {
        name: '20260525120000_add_events',
        custom: false,
        state: 'pending',
        checksum: 'ok',
      },
    ]);
  });

  it('does not include hypequery.sum in the canonical checksum', async () => {
    const migrationDir = await createMigrationDir('20260525120000_add_events');
    const first = await writeMigrationChecksumFile(migrationDir);
    const second = await calculateMigrationChecksum(migrationDir);

    expect(second.checksum).toEqual(first.checksum);
  });
});

async function createMigrationDir(name: string) {
  return createMigrationFilesFixture(tempDir, name);
}
