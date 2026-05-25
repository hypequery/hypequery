import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  createMigrationPlan,
  defineSchema,
  diffSnapshots,
  renderMigrationArtifacts,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  writeMigrationArtifacts,
  type ClickHouseSchemaAst,
  type MigrationMeta,
  type MigrationPlan,
  type Snapshot,
} from '@hypequery/schema';
import { loadModule } from '../utils/load-api.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';

export interface GenerateMigrationOptions {
  config?: string;
  custom?: boolean;
  timestamp?: string;
}

interface MigrationJournal {
  version: 1;
  dialect: 'clickhouse';
  latestSnapshotHash: string;
  migrations: Array<{
    name: string;
    timestamp: string;
    custom: boolean;
    sourceSnapshotHash: string;
    targetSnapshotHash: string;
  }>;
}

const META_DIR_NAME = 'meta';
const LATEST_SNAPSHOT_FILE = 'latest_snapshot.json';
const JOURNAL_FILE = 'migrations.json';

export async function generateMigrationCommand(
  migrationSlug: string | undefined,
  options: GenerateMigrationOptions = {},
) {
  logger.newline();
  logger.header('hypequery generate:migration');

  try {
    assertValidMigrationSlug(migrationSlug);

    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const timestamp = options.timestamp ?? createTimestamp();
    const migrationName = `${timestamp}_${migrationSlug}`;

    await assertMigrationDoesNotExist(migrationsOutDir, migrationName);

    const loadSpinner = ora('Loading migration config...').start();
    const previousSnapshot = await readLatestSnapshot(migrationsOutDir);
    loadSpinner.succeed('Loaded migration config');

    if (options.custom) {
      await writeCustomMigration({
        outDir: migrationsOutDir,
        migrationName,
        timestamp,
        previousSnapshot,
      });

      logger.success(`Created custom migration ${path.relative(process.cwd(), path.join(migrationsOutDir, migrationName))}`);
      logger.newline();
      return;
    }

    const schemaSpinner = ora('Loading schema...').start();
    const schema = await loadSchema(config.schema);
    const nextSnapshot = serializeSchemaToSnapshot(schema);
    schemaSpinner.succeed('Loaded schema');

    const planSpinner = ora('Planning migration...').start();
    const diff = diffSnapshots(previousSnapshot, nextSnapshot);
    const plan = createMigrationPlan(diff);

    if (plan.operations.length === 0) {
      planSpinner.succeed('No schema changes detected');
      logger.info('No migration was generated.');
      logger.newline();
      return;
    }

    const artifacts = renderMigrationArtifacts(plan, {
      name: migrationName,
      timestamp,
      cluster: config.cluster?.name,
    });
    planSpinner.succeed(`Planned ${plan.operations.length} operations`);

    const writeSpinner = ora('Writing migration files...').start();
    const written = await writeMigrationArtifacts({
      outDir: migrationsOutDir,
      migrationName,
      artifacts,
    });
    await writeFile(
      path.join(written.migrationDir, 'snapshot.json'),
      `${snapshotToStableJson(nextSnapshot)}\n`,
      'utf8',
    );
    await writeLatestSnapshot(migrationsOutDir, nextSnapshot);
    await appendJournalEntry(migrationsOutDir, {
      name: migrationName,
      timestamp,
      custom: false,
      sourceSnapshotHash: plan.sourceSnapshotHash,
      targetSnapshotHash: plan.targetSnapshotHash,
    }, nextSnapshot.contentHash);
    writeSpinner.succeed('Wrote migration files');

    logger.success(`Created migration ${path.relative(process.cwd(), written.migrationDir)}`);
    if (artifacts.meta.unsafe || plan.requiredConfirmations.length > 0) {
      logger.warn('Migration contains operations that require review before execution.');
    }
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}

async function loadSchema(schemaPath: string): Promise<ClickHouseSchemaAst> {
  const mod = await loadModule(schemaPath);
  const schema = mod.default ?? mod.schema;

  if (isClickHouseSchemaAst(schema)) {
    return defineSchema({
      tables: schema.tables,
      ...(schema.materializedViews !== undefined ? { materializedViews: schema.materializedViews } : {}),
    });
  }

  const relativePath = path.relative(process.cwd(), path.resolve(process.cwd(), schemaPath));
  const availableExports = Object.keys(mod).filter(key => key !== '__esModule');
  throw new Error(
    `Invalid schema module: ${relativePath}\n\n` +
    `The module must export a defineSchema() result as the default export or as "schema".` +
    (availableExports.length > 0 ? `\n\nFound exports: ${availableExports.join(', ')}` : ''),
  );
}

function isClickHouseSchemaAst(value: unknown): value is ClickHouseSchemaAst {
  if (!isRecord(value) || !Array.isArray(value.tables)) {
    return false;
  }

  return value.materializedViews === undefined || Array.isArray(value.materializedViews);
}

async function readLatestSnapshot(migrationsOutDir: string): Promise<Snapshot> {
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

async function writeLatestSnapshot(migrationsOutDir: string, snapshot: Snapshot) {
  const metaDir = path.join(migrationsOutDir, META_DIR_NAME);
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, LATEST_SNAPSHOT_FILE),
    `${snapshotToStableJson(snapshot)}\n`,
    'utf8',
  );
}

async function appendJournalEntry(
  migrationsOutDir: string,
  entry: MigrationJournal['migrations'][number],
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
        version: parsed.version,
        dialect: parsed.dialect,
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

async function writeCustomMigration(input: {
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

  await appendJournalEntry(input.outDir, {
    name: input.migrationName,
    timestamp: input.timestamp,
    custom: true,
    sourceSnapshotHash: input.previousSnapshot.contentHash,
    targetSnapshotHash: input.previousSnapshot.contentHash,
  }, input.previousSnapshot.contentHash);
}

async function assertMigrationDoesNotExist(migrationsOutDir: string, migrationName: string) {
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

function assertValidMigrationSlug(migrationSlug: string | undefined): asserts migrationSlug is string {
  if (!migrationSlug) {
    throw new Error('Migration name is required. Usage: hypequery generate:migration <name>');
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(migrationSlug)) {
    throw new Error(
      `Invalid migration name "${migrationSlug}". ` +
      'Use only letters, numbers, underscores, and hyphens.',
    );
  }
}

function createTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

function isSnapshot(value: unknown): value is Snapshot {
  return isRecord(value) &&
    value.version === 1 &&
    value.dialect === 'clickhouse' &&
    Array.isArray(value.tables) &&
    Array.isArray(value.materializedViews) &&
    Array.isArray(value.dependencies) &&
    typeof value.contentHash === 'string';
}

function isMigrationJournalEntry(value: unknown): value is MigrationJournal['migrations'][number] {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.custom === 'boolean' &&
    typeof value.sourceSnapshotHash === 'string' &&
    typeof value.targetSnapshotHash === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isNotFoundError(error: unknown) {
  return isRecord(error) && error.code === 'ENOENT';
}
