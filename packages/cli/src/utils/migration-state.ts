import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defineSchema,
  diffSnapshots,
  renderMigrationArtifacts,
  serializeSchemaToSnapshot,
  type ClickHouseSchemaAst,
  type RenderMigrationArtifactsResult,
  type Snapshot,
} from '@hypequery/clickhouse';
import { loadModule } from './load-api.js';
import {
  DEFAULT_HYPEQUERY_CONFIG_PATH,
  loadHypequeryConfig,
} from './load-hypequery-config.js';

export const JOURNAL_FILE_NAME = '_journal.json';
export const SNAPSHOT_FILE_SUFFIX = '_snapshot.json';

export interface MigrationJournal {
  version: 1;
  latestSnapshotPath: string | null;
  snapshots: MigrationJournalSnapshotEntry[];
  migrations: MigrationJournalEntry[];
}

export interface MigrationJournalSnapshotEntry {
  path: string;
  source: 'generated' | 'baseline' | 'legacy_inferred';
  migrationName?: string;
  createdAt?: string;
  snapshotHash?: string;
}

export interface MigrationJournalEntry {
  name: string;
  timestamp: string;
  snapshotPath: string | null;
  createdAt?: string;
  kind: 'generated' | 'custom';
}

export interface PrepareMigrationArtifactsOptions {
  name: string;
  config?: string;
  now?: Date;
}

export interface PreparedMigrationArtifacts {
  config: Awaited<ReturnType<typeof loadHypequeryConfig>>;
  migrationsOutDir: string;
  metaDir: string;
  journal: MigrationJournal;
  previousSnapshot: Snapshot | null;
  nextSnapshot: Snapshot;
  timestamp: string;
  migrationName: string;
  artifacts: RenderMigrationArtifactsResult | null;
}

export async function prepareMigrationArtifacts(
  options: PrepareMigrationArtifactsOptions,
): Promise<PreparedMigrationArtifacts> {
  if (!options.name || options.name.trim().length === 0) {
    throw new Error('Migration name is required. Use --name <slug>.');
  }

  const config = await loadHypequeryConfig(options.config ?? DEFAULT_HYPEQUERY_CONFIG_PATH);
  const schema = await loadManagedSchema(config.schema);
  const nextSnapshot = serializeSchemaToSnapshot(schema);
  const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
  const metaDir = path.join(migrationsOutDir, 'meta');
  const journal = await loadMigrationJournal(metaDir);
  const previousSnapshot = await loadLatestSnapshotFromJournal(metaDir, journal);

  if (previousSnapshot?.contentHash === nextSnapshot.contentHash) {
    return {
      config,
      migrationsOutDir,
      metaDir,
      journal,
      previousSnapshot,
      nextSnapshot,
      timestamp: '',
      migrationName: '',
      artifacts: null,
    };
  }

  const timestamp = formatTimestamp(options.now ?? new Date());
  const migrationName = `${timestamp}_${normalizeMigrationSlug(options.name)}`;
  const diff = diffSnapshots(previousSnapshot ?? createEmptySnapshot(), nextSnapshot);
  const artifacts = renderMigrationArtifacts(diff, {
    name: migrationName,
    timestamp,
    cluster: config.cluster?.name,
  });

  return {
    config,
    migrationsOutDir,
    metaDir,
    journal,
    previousSnapshot,
    nextSnapshot,
    timestamp,
    migrationName,
    artifacts,
  };
}

export async function loadManagedSchema(schemaPath: string): Promise<ClickHouseSchemaAst> {
  const mod = await loadModule(schemaPath);
  const candidate = mod.schema ?? mod.default;

  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.tables)) {
    throw new Error(
      `Invalid schema module: ${schemaPath}\n\n` +
      `The schema module must export a ClickHouse schema AST as "schema" or as the default export.`,
    );
  }

  return candidate as ClickHouseSchemaAst;
}

export async function loadMigrationJournal(metaDir: string): Promise<MigrationJournal> {
  const journalPath = path.join(metaDir, JOURNAL_FILE_NAME);

  try {
    const contents = await readFile(journalPath, 'utf8');
    return parseMigrationJournal(contents, journalPath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return inferLegacyJournal(metaDir);
    }
    throw error;
  }
}

export async function writeMigrationJournal(metaDir: string, journal: MigrationJournal): Promise<string> {
  await mkdir(metaDir, { recursive: true });
  const journalPath = path.join(metaDir, JOURNAL_FILE_NAME);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  return journalPath;
}

export async function loadLatestSnapshotFromJournal(
  metaDir: string,
  journal: MigrationJournal,
): Promise<Snapshot | null> {
  if (!journal.latestSnapshotPath) {
    return null;
  }

  const latestSnapshotPath = path.join(metaDir, journal.latestSnapshotPath);
  const contents = await readFile(latestSnapshotPath, 'utf8');
  return JSON.parse(contents) as Snapshot;
}

export function recordGeneratedMigration(
  journal: MigrationJournal,
  input: {
    migrationName: string;
    timestamp: string;
    snapshotFileName: string;
    snapshotHash: string;
    createdAt: string;
  },
): MigrationJournal {
  const snapshots = journal.snapshots.filter(entry => entry.path !== input.snapshotFileName);
  snapshots.push({
    path: input.snapshotFileName,
    source: 'generated',
    migrationName: input.migrationName,
    createdAt: input.createdAt,
    snapshotHash: input.snapshotHash,
  });

  const migrations = journal.migrations.filter(entry => entry.name !== input.migrationName);
      migrations.push({
        name: input.migrationName,
        timestamp: input.timestamp,
        snapshotPath: input.snapshotFileName,
        createdAt: input.createdAt,
    kind: 'generated',
  });

  return {
    version: 1,
    latestSnapshotPath: input.snapshotFileName,
    snapshots: snapshots.sort((left, right) => left.path.localeCompare(right.path)),
    migrations: migrations.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function recordCustomMigration(
  journal: MigrationJournal,
  input: {
    migrationName: string;
    timestamp: string;
    createdAt: string;
  },
): MigrationJournal {
  const migrations = journal.migrations.filter(entry => entry.name !== input.migrationName);
  migrations.push({
    name: input.migrationName,
    timestamp: input.timestamp,
    snapshotPath: null,
    createdAt: input.createdAt,
    kind: 'custom',
  });

  return {
    version: 1,
    latestSnapshotPath: journal.latestSnapshotPath,
    snapshots: [...journal.snapshots].sort((left, right) => left.path.localeCompare(right.path)),
    migrations: migrations.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function getLatestTrackedMigration(journal: MigrationJournal): MigrationJournalEntry | null {
  if (journal.migrations.length === 0) {
    return null;
  }

  return [...journal.migrations].sort((left, right) => left.name.localeCompare(right.name)).at(-1) ?? null;
}

export function removeTrackedMigration(
  journal: MigrationJournal,
  migrationName: string,
): MigrationJournal {
  const migration = journal.migrations.find(entry => entry.name === migrationName);

  if (!migration) {
    throw new Error(`Migration "${migrationName}" is not recorded in the local journal.`);
  }

  const snapshots = journal.snapshots
    .filter(entry => !migration.snapshotPath || entry.path !== migration.snapshotPath)
    .sort((left, right) => left.path.localeCompare(right.path));
  const migrations = journal.migrations
    .filter(entry => entry.name !== migrationName)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    version: 1,
    latestSnapshotPath: snapshots.at(-1)?.path ?? null,
    snapshots,
    migrations,
  };
}

export function normalizeMigrationSlug(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.length === 0) {
    throw new Error(
      `Invalid migration name "${name}". Use letters, numbers, underscores, or hyphens.`,
    );
  }

  return normalized;
}

export function formatTimestamp(date: Date): string {
  const parts = [
    date.getUTCFullYear(),
    padTimestampPart(date.getUTCMonth() + 1),
    padTimestampPart(date.getUTCDate()),
    padTimestampPart(date.getUTCHours()),
    padTimestampPart(date.getUTCMinutes()),
    padTimestampPart(date.getUTCSeconds()),
  ];

  return parts.join('');
}

function createEmptySnapshot(): Snapshot {
  return serializeSchemaToSnapshot(defineSchema({ tables: [] }));
}

async function inferLegacyJournal(metaDir: string): Promise<MigrationJournal> {
  let entries: string[];

  try {
    entries = await readdir(metaDir);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return createEmptyJournal();
    }
    throw error;
  }

  const snapshotFiles = entries
    .filter(entry => entry.endsWith(SNAPSHOT_FILE_SUFFIX))
    .sort();

  return {
    version: 1,
    latestSnapshotPath: snapshotFiles[snapshotFiles.length - 1] ?? null,
    snapshots: snapshotFiles.map((snapshotPath) => (
      snapshotPath === `0000${SNAPSHOT_FILE_SUFFIX}`
        ? { path: snapshotPath, source: 'baseline' as const }
        : { path: snapshotPath, source: 'legacy_inferred' as const }
    )),
    migrations: snapshotFiles
      .filter(snapshotPath => snapshotPath !== `0000${SNAPSHOT_FILE_SUFFIX}`)
      .map((snapshotPath) => {
        const migrationName = snapshotPath.slice(0, -SNAPSHOT_FILE_SUFFIX.length);
        const timestampMatch = migrationName.match(/^(\d{14})_/);

        return {
          name: migrationName,
          timestamp: timestampMatch?.[1] ?? '',
          snapshotPath,
          kind: 'generated' as const,
        };
      }),
  };
}

function createEmptyJournal(): MigrationJournal {
  return {
    version: 1,
    latestSnapshotPath: null,
    snapshots: [],
    migrations: [],
  };
}

function parseMigrationJournal(contents: string, journalPath: string): MigrationJournal {
  const parsed = JSON.parse(contents) as Partial<MigrationJournal>;

  if (
    parsed.version !== 1 ||
    (parsed.latestSnapshotPath !== null && parsed.latestSnapshotPath !== undefined && typeof parsed.latestSnapshotPath !== 'string') ||
    !Array.isArray(parsed.snapshots) ||
    !Array.isArray(parsed.migrations)
  ) {
    throw new Error(
      `Invalid migration journal: ${journalPath}\n\n` +
      `Expected a versioned journal with "latestSnapshotPath", "snapshots", and "migrations".`,
    );
  }

  return {
    version: 1,
    latestSnapshotPath: parsed.latestSnapshotPath ?? null,
    snapshots: parsed.snapshots as MigrationJournalSnapshotEntry[],
    migrations: parsed.migrations as MigrationJournalEntry[],
  };
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, '0');
}
