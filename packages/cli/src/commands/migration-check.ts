import path from 'node:path';
import ora from 'ora';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { verifyMigrationIntegrity } from '../utils/migration-checksums.js';

export interface MigrationCheckOptions {
  config?: string;
}

export async function migrationCheckCommand(options: MigrationCheckOptions = {}) {
  logger.newline();
  logger.header('hypequery migrate:check');

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);

    const spinner = ora('Checking migration files...').start();
    const results = await verifyMigrationIntegrity(migrationsOutDir);
    spinner.succeed('Checked migration files');

    if (results.length === 0) {
      logger.info('No local migrations found.');
      logger.newline();
      return;
    }

    const failures = results.filter(result => !result.ok);
    if (failures.length === 0) {
      logger.success(`Verified ${results.length} migration${results.length === 1 ? '' : 's'}`);
      logger.newline();
      return;
    }

    for (const failure of failures) {
      logger.warn(formatIntegrityFailure(failure));
    }

    throw new Error(`${failures.length} migration${failures.length === 1 ? '' : 's'} failed integrity checks.`);
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}

function formatIntegrityFailure(failure: {
  migrationName: string;
  missingChecksumFile: boolean;
  changedFiles: string[];
  missingFiles: string[];
  extraFiles: string[];
}) {
  if (failure.missingChecksumFile) {
    return `${failure.migrationName}: missing hypequery.sum`;
  }

  const details = [
    ...failure.changedFiles.map(file => `changed ${file}`),
    ...failure.missingFiles.map(file => `missing ${file}`),
    ...failure.extraFiles.map(file => `extra ${file}`),
  ];

  return `${failure.migrationName}: ${details.join(', ')}`;
}
