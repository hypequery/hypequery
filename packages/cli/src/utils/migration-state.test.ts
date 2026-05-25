import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  column,
  defineSchema,
  defineTable,
  serializeSchemaToSnapshot,
} from '@hypequery/schema';
import {
  appendMigrationJournalEntry,
  readLatestMigrationSnapshot,
  writeLatestMigrationSnapshot,
} from './migration-state.js';

describe('migration state utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-migration-state-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns an empty snapshot when no latest snapshot exists', async () => {
    const snapshot = await readLatestMigrationSnapshot(tempDir);

    expect(snapshot.tables).toEqual([]);
    expect(snapshot.materializedViews).toEqual([]);
    expect(snapshot.dependencies).toEqual([]);
  });

  it('writes and reads the latest snapshot', async () => {
    const snapshot = eventsSnapshot();

    await writeLatestMigrationSnapshot(tempDir, snapshot);

    await expect(readLatestMigrationSnapshot(tempDir)).resolves.toEqual(snapshot);
  });

  it('rejects invalid latest snapshot files', async () => {
    const metaDir = path.join(tempDir, 'meta');
    await mkdir(metaDir, { recursive: true });
    await writeFile(path.join(metaDir, 'latest_snapshot.json'), '{"version":1}\n', 'utf8');

    await expect(readLatestMigrationSnapshot(tempDir)).rejects.toThrow(/Invalid latest snapshot file/);
  });

  it('appends migration journal entries', async () => {
    await appendMigrationJournalEntry(tempDir, {
      name: '20260525130000_add_events',
      timestamp: '20260525130000',
      custom: false,
      sourceSnapshotHash: 'from',
      targetSnapshotHash: 'to',
    }, 'to');

    const journal = JSON.parse(await readFile(path.join(tempDir, 'meta', 'migrations.json'), 'utf8'));
    expect(journal).toMatchObject({
      version: 1,
      dialect: 'clickhouse',
      latestSnapshotHash: 'to',
      migrations: [
        {
          name: '20260525130000_add_events',
          custom: false,
        },
      ],
    });
  });
});

function eventsSnapshot() {
  return serializeSchemaToSnapshot(defineSchema({
    tables: [
      defineTable('events', {
        columns: {
          id: column.UUID(),
          created_at: column.DateTime(),
        },
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
        },
      }),
    ],
  }));
}
