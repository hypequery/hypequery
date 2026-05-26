import path from 'node:path';
import ora from 'ora';
import { createMigrationClickHouseClient } from '../utils/clickhouse-migration-introspection.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { fetchAppliedMigrationsIfTableExists } from '../utils/migration-remote-state.js';
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
    const remoteState = await readRemoteMigrationState({
      migrationTable: config.migrations.table,
      credentials: config.dbCredentials,
    });
    const statuses = await getLocalMigrationStatuses(migrationsOutDir, remoteState.appliedMigrations);
    spinner.succeed('Read migration metadata');

    if (statuses.length === 0) {
      logger.info('No local migrations found.');
      logger.newline();
      return;
    }

    logger.table(
      ['Migration', 'Type', 'State', 'Checksum', 'Remote', 'Steps'],
      statuses.map(status => [
        status.name,
        status.custom ? 'custom' : 'generated',
        status.state,
        status.checksum,
        status.remoteChecksum ?? '-',
        status.progress ?? '-',
      ]),
    );
    if (remoteState.warning) {
      logger.warn(remoteState.warning);
    }
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}

async function readRemoteMigrationState(input: {
  migrationTable: string;
  credentials: Parameters<typeof createMigrationClickHouseClient>[0];
}) {
  const client = createMigrationClickHouseClient(input.credentials);
  try {
    return {
      appliedMigrations: await fetchAppliedMigrationsIfTableExists({
        client,
        migrationTable: input.migrationTable,
      }),
    };
  } catch (error) {
    return {
      appliedMigrations: [],
      warning: `Remote migration state unavailable; showing local status only. ${formatError(error)}`,
    };
  } finally {
    await client.close();
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
