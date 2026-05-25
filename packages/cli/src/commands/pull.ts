import { access } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { introspectClickHouseSchema } from '../utils/clickhouse-migration-introspection.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { relativeSchemaPath, writeSchemaFileFromSnapshot } from '../utils/migration-schema-emitter.js';
import { initializeMigrationJournal, writeLatestMigrationSnapshot } from '../utils/migration-state.js';
import { isRecord } from '../utils/runtime-guards.js';

export interface PullOptions {
  config?: string;
  force?: boolean;
  tables?: string;
  excludeTables?: string;
}

export async function pullCommand(options: PullOptions = {}) {
  logger.newline();
  logger.header('hypequery pull');

  try {
    const config = await loadHypequeryConfig(options.config);
    const schemaPath = path.resolve(process.cwd(), config.schema);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);

    if (!options.force) {
      await assertWritableBaselineTargets(schemaPath, migrationsOutDir);
    }

    const spinner = ora('Introspecting ClickHouse schema...').start();
    const snapshot = await introspectClickHouseSchema({
      credentials: config.dbCredentials,
      includeTables: parseTableList(options.tables),
      excludeTables: parseTableList(options.excludeTables),
    });
    spinner.succeed(`Introspected ${snapshot.tables.length} tables`);

    const writeSpinner = ora('Writing baseline files...').start();
    const writtenSchemaPath = await writeSchemaFileFromSnapshot({
      snapshot,
      outputPath: config.schema,
    });
    await writeLatestMigrationSnapshot(migrationsOutDir, snapshot);
    await initializeMigrationJournal(migrationsOutDir, snapshot.contentHash);
    writeSpinner.succeed('Wrote baseline files');

    logger.success(`Wrote schema ${path.relative(process.cwd(), writtenSchemaPath)}`);
    logger.success(`Initialized migration metadata ${path.relative(process.cwd(), migrationsOutDir)}/meta`);
    logger.newline();
    logger.info('Review the generated schema before using it as your long-term source of truth.');
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}

async function assertWritableBaselineTargets(schemaPath: string, migrationsOutDir: string) {
  const existingPath = await firstExistingPath([
    schemaPath,
    path.join(migrationsOutDir, 'meta', 'latest_snapshot.json'),
    path.join(migrationsOutDir, 'meta', 'migrations.json'),
  ]);

  if (existingPath) {
    throw new Error(
      `Baseline file already exists: ${relativeSchemaPath(existingPath)}\n\n` +
      'Use --force to overwrite baseline files.',
    );
  }
}

async function firstExistingPath(paths: string[]) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  return null;
}

function parseTableList(value: string | undefined) {
  return value
    ?.split(',')
    .map(table => table.trim())
    .filter(Boolean);
}

function isNotFoundError(error: unknown) {
  return isRecord(error) && error.code === 'ENOENT';
}
