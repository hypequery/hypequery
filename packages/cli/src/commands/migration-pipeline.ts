import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  diffSnapshots,
  hashSnapshot,
  serializeSchemaToSnapshot,
  type ClickHouseSchemaAst,
  type ResolvedHypequeryClickHouseConfig,
  type Snapshot,
  type SnapshotDiffResult,
} from '@hypequery/clickhouse';
import { DEFAULT_HYPEQUERY_CONFIG_PATH, loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { loadModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

export interface MigrationPipelineContext {
  configPath: string;
  resolvedConfigPath: string;
  configDir: string;
  config: ResolvedHypequeryClickHouseConfig;
  schemaModulePath: string;
  migrationsOutDir: string;
  migrationsMetaDir: string;
  schema: ClickHouseSchemaAst;
  previousSnapshot: Snapshot | null;
  nextSnapshot: Snapshot;
  diff: SnapshotDiffResult;
}

export async function prepareMigrationPipeline(
  configPath = DEFAULT_HYPEQUERY_CONFIG_PATH,
): Promise<MigrationPipelineContext> {
  const config = await loadConfigOrExit(configPath);
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const schemaModulePath = path.resolve(configDir, config.schema);
  const migrationsOutDir = path.resolve(configDir, config.migrations.out);
  const migrationsMetaDir = path.join(migrationsOutDir, 'meta');

  const schema = await loadSchemaOrExit(schemaModulePath);
  const nextSnapshot = serializeSchemaToSnapshot(schema);
  const previousSnapshot = await loadLatestSnapshot(migrationsMetaDir);
  const baseSnapshot = previousSnapshot ?? createEmptySnapshot();
  const diff = diffSnapshots(baseSnapshot, nextSnapshot);

  return {
    configPath,
    resolvedConfigPath,
    configDir,
    config,
    schemaModulePath,
    migrationsOutDir,
    migrationsMetaDir,
    schema,
    previousSnapshot,
    nextSnapshot,
    diff,
  };
}

export async function loadConfigOrExit(configPath: string) {
  const spinner = ora(`Loading config from ${configPath}...`).start();
  try {
    const config = await loadHypequeryConfig(configPath);
    spinner.succeed('Loaded hypequery config');
    return config;
  } catch (error) {
    spinner.fail('Failed to load hypequery config');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function loadSchemaOrExit(schemaModulePath: string): Promise<ClickHouseSchemaAst> {
  const spinner = ora(`Loading schema from ${path.relative(process.cwd(), schemaModulePath)}...`).start();
  try {
    const mod = await loadModule(schemaModulePath);
    const candidate = mod.default ?? mod.schema;

    if (!isSchemaAst(candidate)) {
      throw new Error(
        `Invalid schema module: ${path.relative(process.cwd(), schemaModulePath)}\n\n` +
        `Expected the module to export defineSchema(...) as the default export or as 'schema'.`,
      );
    }

    spinner.succeed('Loaded schema definition');
    return candidate;
  } catch (error) {
    spinner.fail('Failed to load schema definition');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function loadLatestSnapshot(metaDir: string): Promise<Snapshot | null> {
  try {
    const entries = await readdir(metaDir);
    const snapshotFiles = entries
      .filter(name => name === '0000_snapshot.json' || name.endsWith('_snapshot.json'))
      .sort();

    if (snapshotFiles.length === 0) {
      return null;
    }

    const latestSnapshotPath = path.join(metaDir, snapshotFiles[snapshotFiles.length - 1]);
    const contents = await readFile(latestSnapshotPath, 'utf8');
    return JSON.parse(contents) as Snapshot;
  } catch {
    return null;
  }
}

export function createEmptySnapshot(): Snapshot {
  const snapshot: Omit<Snapshot, 'contentHash'> = {
    version: 1,
    dialect: 'clickhouse',
    tables: [],
    materializedViews: [],
    dependencies: [],
  };

  return {
    ...snapshot,
    contentHash: hashSnapshot(snapshot),
  };
}

export function isSchemaAst(value: unknown): value is ClickHouseSchemaAst {
  return typeof value === 'object' &&
    value !== null &&
    'tables' in value &&
    Array.isArray((value as { tables?: unknown }).tables);
}

export function slugifyMigrationName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug.length > 0 ? slug : null;
}

export function createTimestamp(date = new Date()): string {
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ];

  return parts.join('');
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}
