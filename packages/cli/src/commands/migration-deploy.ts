import path from 'node:path';
import ora from 'ora';
import { applyPendingMigrations } from '../utils/migration-execution.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';

export interface MigrationDeployOptions {
  config?: string;
}

export async function migrationDeployCommand(options: MigrationDeployOptions = {}) {
  logger.newline();
  logger.header('hypequery migrate:deploy');

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);

    logger.warn('Distributed migration locking is not implemented yet; run only one deploy process at a time.');
    logger.warn('ClickHouse DDL is not transactional. Failed migrations may leave partial side effects.');

    const spinner = ora('Applying pending migrations...').start();
    const results = await applyPendingMigrations({
      migrationsOutDir,
      migrationTable: config.migrations.table,
      credentials: config.dbCredentials,
      cluster: config.cluster?.name,
    });
    spinner.succeed('Checked remote migration state');

    const applied = results.filter(result => result.state === 'applied');
    const skipped = results.filter(result => result.state === 'skipped');

    if (results.length === 0) {
      logger.info('No local migrations found.');
      logger.newline();
      return;
    }

    if (applied.length > 0) {
      logger.table(
        ['Migration', 'State', 'Steps'],
        applied.map(result => [
          result.name,
          result.state,
          `${result.appliedStepCount}/${result.totalSteps}`,
        ]),
      );
    }

    if (skipped.length > 0) {
      logger.info(`Skipped ${skipped.length} already-applied migration${skipped.length === 1 ? '' : 's'}.`);
    }

    if (applied.length === 0) {
      logger.success('No pending migrations.');
    } else {
      logger.success(`Applied ${applied.length} migration${applied.length === 1 ? '' : 's'}.`);
    }
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
