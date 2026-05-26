import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defineSchema,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  type MigrationMeta,
  type MigrationPlan,
  type Snapshot,
} from '@hypequery/schema';
import { verifyMigrationIntegrity, writeMigrationChecksumFile } from './migration-checksums.js';
import type { AppliedMigrationRecord } from './migration-remote-state.js';
import { isMigrationJournalEntry, isSnapshot } from './migration-metadata-guards.js';
import { isNotFoundError, isRecord } from './runtime-guards.js';

export interface MigrationJournalEntry {
  name: string;
  timestamp: string;
  custom: boolean;
  sourceSnapshotHash: string;
  targetSnapshotHash: string;
  checksum?: string;
}

export interface MigrationJournal {
  version: 1;
  dialect: 'clickhouse';
  latestSnapshotHash: string;
  migrations: MigrationJournalEntry[];
}

export interface LocalMigrationStatus {
  name: string;
  custom: boolean;
  state: 'pending' | 'applied' | 'failed';
  checksum: 'ok' | 'missing' | 'mismatch';
  remoteChecksum?: 'ok' | 'mismatch';
  progress?: string;
}

const META_DIR_NAME = 'meta';
const LATEST_SNAPSHOT_FILE = 'latest_snapshot.json';
const JOURNAL_FILE = 'migrations.json';

export async function readLatestMigrationSnapshot(migrationsOutDir: string): Promise<Snapshot> {
  const snapshotPath = path.join(migrationsOutDir, META_DIR_NAME, LATEST_SNAPSHOT_FILE);

  try {
    const contents = await readFile(snapshotPath, 'utf8');
    const parsed: unknown = JSON.parse(contents);
    if (isSnapshot(parsed)) {
      return parsed;
    }
    throw new Error(`Invalid latest snapshot file: ${path.relative(process.cwd(), snapshotPath)}`);
  } catch (error) {
    if (isNotFoundError(error)) {
      return serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    }
    throw error;
  }
}

export async function writeLatestMigrationSnapshot(migrationsOutDir: string, snapshot: Snapshot) {
  const metaDir = path.join(migrationsOutDir, META_DIR_NAME);
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, LATEST_SNAPSHOT_FILE),
    `${snapshotToStableJson(snapshot)}\n`,
    'utf8',
  );
}

export async function appendMigrationJournalEntry(
  migrationsOutDir: string,
  entry: MigrationJournalEntry,
  latestSnapshotHash: string,
) {
  const metaDir = path.join(migrationsOutDir, META_DIR_NAME);
  const journalPath = path.join(metaDir, JOURNAL_FILE);
  await mkdir(metaDir, { recursive: true });

  const journal = await readJournal(journalPath);
  const nextJournal: MigrationJournal = {
    ...journal,
    latestSnapshotHash,
    migrations: [
      ...journal.migrations.filter(migration => migration.name !== entry.name),
      entry,
    ],
  };

  await writeFile(journalPath, `${JSON.stringify(nextJournal, null, 2)}\n`, 'utf8');
}

export async function readMigrationJournal(migrationsOutDir: string) {
  return readJournal(path.join(migrationsOutDir, META_DIR_NAME, JOURNAL_FILE));
}

export async function initializeMigrationJournal(
  migrationsOutDir: string,
  latestSnapshotHash: string,
) {
  const metaDir = path.join(migrationsOutDir, META_DIR_NAME);
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, JOURNAL_FILE),
    `${JSON.stringify({
      version: 1,
      dialect: 'clickhouse',
      latestSnapshotHash,
      migrations: [],
    } satisfies MigrationJournal, null, 2)}\n`,
    'utf8',
  );
}

export async function writeCustomMigration(input: {
  outDir: string;
  migrationName: string;
  timestamp: string;
  previousSnapshot: Snapshot;
}) {
  const migrationDir = path.join(input.outDir, input.migrationName);
  await mkdir(migrationDir, { recursive: true });

  const meta: MigrationMeta = {
    name: input.migrationName,
    timestamp: input.timestamp,
    operations: [],
    sourceSnapshotHash: input.previousSnapshot.contentHash,
    targetSnapshotHash: input.previousSnapshot.contentHash,
    custom: true,
    unsafe: true,
    containsManualSteps: true,
  };

  const plan: MigrationPlan = {
    previousSnapshot: input.previousSnapshot,
    nextSnapshot: input.previousSnapshot,
    sourceSnapshotHash: input.previousSnapshot.contentHash,
    targetSnapshotHash: input.previousSnapshot.contentHash,
    operations: [],
    diagnostics: [],
    blockers: [],
    requiredConfirmations: [],
    recommendedSyncSettings: [],
    requiredSyncSettings: [],
  };

  await writeFile(path.join(migrationDir, 'up.sql'), '-- Write custom migration SQL here.\n', 'utf8');
  await writeFile(path.join(migrationDir, 'down.sql'), '-- Write best-effort rollback SQL here.\n', 'utf8');
  await writeFile(path.join(migrationDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  await writeFile(path.join(migrationDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  const checksumFile = await writeMigrationChecksumFile(migrationDir);

  await appendMigrationJournalEntry(input.outDir, {
    name: input.migrationName,
    timestamp: input.timestamp,
    custom: true,
    sourceSnapshotHash: input.previousSnapshot.contentHash,
    targetSnapshotHash: input.previousSnapshot.contentHash,
    checksum: checksumFile.checksum,
  }, input.previousSnapshot.contentHash);
}

export async function assertMigrationDoesNotExist(migrationsOutDir: string, migrationName: string) {
  const migrationDir = path.join(migrationsOutDir, migrationName);
  try {
    await access(migrationDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }

  throw new Error(`Migration already exists: ${path.relative(process.cwd(), migrationDir)}`);
}

export async function getLocalMigrationStatuses(
  migrationsOutDir: string,
  appliedMigrations: AppliedMigrationRecord[] = [],
): Promise<LocalMigrationStatus[]> {
  const journal = await readMigrationJournal(migrationsOutDir);
  const integrityResults = await verifyMigrationIntegrity(migrationsOutDir);
  const integrityByName = new Map(integrityResults.map(result => [result.migrationName, result]));
  const appliedByName = new Map(appliedMigrations.map(result => [result.name, result]));

  return journal.migrations.map(entry => {
    const integrity = integrityByName.get(entry.name);
    const applied = appliedByName.get(entry.name);
    return {
      name: entry.name,
      custom: entry.custom,
      state: applied?.status === 'applied' || applied?.status === 'failed' ? applied.status : 'pending',
      checksum: !integrity || integrity.missingChecksumFile ? 'missing' : integrity.ok ? 'ok' : 'mismatch',
      ...(applied && entry.checksum
        ? { remoteChecksum: applied.checksum === entry.checksum ? 'ok' as const : 'mismatch' as const }
        : {}),
      ...(applied ? { progress: `${applied.appliedStepCount}/${applied.totalSteps}` } : {}),
    };
  });
}

async function readJournal(journalPath: string): Promise<MigrationJournal> {
  try {
    const contents = await readFile(journalPath, 'utf8');
    const parsed: unknown = JSON.parse(contents);
    if (
      isRecord(parsed) &&
      parsed.version === 1 &&
      parsed.dialect === 'clickhouse' &&
      Array.isArray(parsed.migrations) &&
      typeof parsed.latestSnapshotHash === 'string' &&
      parsed.migrations.every(isMigrationJournalEntry)
    ) {
      return {
        version: 1,
        dialect: 'clickhouse',
        latestSnapshotHash: parsed.latestSnapshotHash,
        migrations: parsed.migrations,
      };
    }
    throw new Error(`Invalid migration journal: ${path.relative(process.cwd(), journalPath)}`);
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        version: 1,
        dialect: 'clickhouse',
        latestSnapshotHash: '',
        migrations: [],
      };
    }
    throw error;
  }
}
