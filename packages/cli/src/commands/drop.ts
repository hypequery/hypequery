import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { DEFAULT_HYPEQUERY_CONFIG_PATH } from '../utils/load-hypequery-config.js';
import { loadConfigOrExit } from './migration-pipeline.js';

export interface DropOptions {
  config?: string;
}

interface MigrationEntry {
  name: string;
  migrationDir: string;
  snapshotPath: string;
}

export async function dropCommand(options: DropOptions = {}) {
  const configPath = options.config ?? DEFAULT_HYPEQUERY_CONFIG_PATH;

  logger.newline();
  logger.header('hypequery drop');

  const config = await loadConfigOrExit(configPath);
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const migrationsOutDir = path.resolve(configDir, config.migrations.out);
  const migrationsMetaDir = path.join(migrationsOutDir, 'meta');

  const latestMigration = await findLatestGeneratedMigration(migrationsOutDir, migrationsMetaDir);
  if (!latestMigration) {
    logger.error('No generated migrations found to drop.');
    process.exit(1);
  }

  const spinner = ora(`Removing ${latestMigration.name}...`).start();

  try {
    await rm(latestMigration.migrationDir, { recursive: true, force: true });
    await rm(latestMigration.snapshotPath, { force: true });

    spinner.succeed(`Removed ${latestMigration.name}`);
    logger.success(`Deleted migration directory: ${path.relative(process.cwd(), latestMigration.migrationDir)}`);
    logger.success(`Deleted snapshot: ${path.relative(process.cwd(), latestMigration.snapshotPath)}`);
    logger.newline();
  } catch (error) {
    spinner.fail(`Failed to remove ${latestMigration.name}`);
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function findLatestGeneratedMigration(
  migrationsOutDir: string,
  migrationsMetaDir: string,
): Promise<MigrationEntry | null> {
  try {
    const entries = await readdir(migrationsOutDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'meta' && /^\d{14}_[A-Za-z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (candidates.length === 0) {
      return null;
    }

    const name = candidates[candidates.length - 1];
    return {
      name,
      migrationDir: path.join(migrationsOutDir, name),
      snapshotPath: path.join(migrationsMetaDir, `${name}_snapshot.json`),
    };
  } catch {
    return null;
  }
}
