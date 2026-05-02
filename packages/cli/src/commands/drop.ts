import { rm } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import {
  getLatestTrackedMigration,
  loadMigrationJournal,
  removeTrackedMigration,
  writeMigrationJournal,
} from '../utils/migration-state.js';

export interface DropOptions {
  config?: string;
}

export async function dropCommand(options: DropOptions = {}): Promise<void> {
  logger.command('drop', 'Remove the latest locally tracked migration and rewind local metadata.');
  logger.phase('Inspecting local migration state');

  const spinner = ora('Loading migration journal...').start();

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const metaDir = path.join(migrationsOutDir, 'meta');
    const journal = await loadMigrationJournal(metaDir);
    const latestMigration = getLatestTrackedMigration(journal);

    if (!latestMigration) {
      spinner.succeed('No generated migrations to drop');
      logger.callout('Nothing To Drop', [
        'The local migration journal does not contain any generated migrations.',
      ]);
      return;
    }

    logger.phase('Removing local artifacts');
    spinner.text = `Removing ${latestMigration.name}...`;
    const migrationDir = path.join(migrationsOutDir, latestMigration.name);
    const snapshotPath = latestMigration.snapshotPath
      ? path.join(metaDir, latestMigration.snapshotPath)
      : null;

    await rm(migrationDir, { recursive: true, force: true });
    if (snapshotPath) {
      await rm(snapshotPath, { force: true });
    }

    const nextJournal = removeTrackedMigration(journal, latestMigration.name);
    const journalPath = await writeMigrationJournal(metaDir, nextJournal);

    spinner.succeed(`Dropped migration ${latestMigration.name}`);
    const rows: Array<[string, string]> = [
      ['migration', latestMigration.name],
      ['artifacts', path.relative(process.cwd(), migrationDir)],
      ['journal', path.relative(process.cwd(), journalPath)],
    ];
    if (snapshotPath) {
      rows.splice(2, 0, ['snapshot', path.relative(process.cwd(), snapshotPath)]);
    }
    logger.kv(rows);
  } catch (error) {
    spinner.fail('Failed to drop migration');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
