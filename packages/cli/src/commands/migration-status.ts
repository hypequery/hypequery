import path from 'node:path';
import ora from 'ora';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { getLocalMigrationStatuses } from '../utils/migration-state.js';

export interface MigrationStatusOptions {
  config?: string;
}

export async function migrationStatusCommand(options: MigrationStatusOptions = {}) {
  logger.newline();
  logger.header('hypequery migrate:status');

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);

    const spinner = ora('Reading migration metadata...').start();
    const statuses = await getLocalMigrationStatuses(migrationsOutDir);
    spinner.succeed('Read migration metadata');

    if (statuses.length === 0) {
      logger.info('No local migrations found.');
      logger.newline();
      return;
    }

    logger.table(
      ['Migration', 'Type', 'State', 'Checksum'],
      statuses.map(status => [
        status.name,
        status.custom ? 'custom' : 'generated',
        status.state,
        status.checksum,
      ]),
    );
    logger.newline();
    logger.info('Apply-state tracking is not implemented yet; local migrations are shown as pending.');
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
