import path from 'node:path';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { loadMigrationJournal } from '../utils/migration-state.js';
import {
  loadMigrationFilesBatch,
  toClickHouseUrl,
  tryLoadAppliedMigrationStatuses,
} from '../utils/migration-execution.js';

export interface CheckOptions {
  config?: string;
}

export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  logger.command('check', 'Verify applied migration integrity against local files.');
  logger.phase('Loading migration state');

  const spinner = ora('Loading migration journal...').start();
  let client: ClickHouseClient | null = null;

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const metaDir = path.join(migrationsOutDir, 'meta');
    const journal = await loadMigrationJournal(metaDir);
    const localEntries = [...journal.migrations].sort((left, right) => left.name.localeCompare(right.name));
    const localFiles = await loadMigrationFilesBatch(migrationsOutDir, localEntries);
    const localByName = new Map(localFiles.map(file => [file.migrationName, file]));

    logger.phase('Inspecting ClickHouse migration table');
    spinner.text = 'Connecting to ClickHouse...';
    client = createClient({
      url: toClickHouseUrl(config.dbCredentials),
      username: config.dbCredentials.username,
      password: config.dbCredentials.password ?? '',
      database: config.dbCredentials.database,
    });

    const appliedByName = await tryLoadAppliedMigrationStatuses(client, config.migrations.table);
    if (!appliedByName) {
      spinner.fail('Migration check failed');
      logger.callout('Missing Applied State', [
        'The ClickHouse migration table is not initialized yet.',
        'Run `hypequery migrate` before relying on execution-state integrity checks.',
      ]);
      process.exit(1);
    }

    const appliedRows = Array.from(appliedByName.values());
    const failedRows = appliedRows.filter(row => row.status === 'failed');
    const checksumDrift = appliedRows.filter((row) => {
      if (row.status !== 'completed') {
        return false;
      }
      const local = localByName.get(row.migration_name);
      return Boolean(local && local.checksum !== row.checksum);
    });
    const missingLocal = appliedRows.filter((row) => {
      if (row.status !== 'completed') {
        return false;
      }
      return !localByName.has(row.migration_name);
    });

    logger.kv([
      ['directory', path.relative(process.cwd(), migrationsOutDir)],
      ['tracked', String(localEntries.length)],
      ['applied', String(appliedRows.filter(row => row.status === 'completed').length)],
      ['failed', String(failedRows.length)],
      ['drift', String(checksumDrift.length)],
      ['missing', String(missingLocal.length)],
    ]);

    if (failedRows.length > 0 || checksumDrift.length > 0 || missingLocal.length > 0) {
      spinner.fail('Migration check failed');
      logger.newline();
      logger.table(
        ['Migration', 'Issue'],
        [
          ...failedRows.map(row => [row.migration_name, 'failed in ClickHouse']),
          ...checksumDrift.map(row => [row.migration_name, 'checksum mismatch']),
          ...missingLocal.map(row => [row.migration_name, 'missing local files']),
        ],
      );
      logger.newline();
      logger.callout('Reconciliation Required', [
        'Recorded applied state no longer matches a clean local migration history.',
        'Resolve failed entries, restore missing files, or repair checksum drift before continuing.',
      ]);
      process.exit(1);
    }

    spinner.succeed('Migration check passed');
    logger.callout('Integrity OK', [
      'Applied ClickHouse migration records match the current local files.',
    ]);
  } catch (error) {
    spinner.fail('Migration check failed');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  } finally {
    await client?.close().catch(() => undefined);
  }
}
