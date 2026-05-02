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

export interface StatusOptions {
  config?: string;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  logger.command('status', 'Inspect local migration journal state.');
  logger.phase('Reading local journal');

  const spinner = ora('Loading migration journal...').start();
  let client: ClickHouseClient | null = null;

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const metaDir = path.join(migrationsOutDir, 'meta');
    const journal = await loadMigrationJournal(metaDir);
    const localMigrations = [...journal.migrations].sort((left, right) => left.name.localeCompare(right.name));
    const localMigrationFiles = await loadMigrationFilesBatch(migrationsOutDir, localMigrations);

    logger.phase('Inspecting ClickHouse migration table');
    spinner.text = 'Connecting to ClickHouse...';
    client = createClient({
      url: toClickHouseUrl(config.dbCredentials),
      username: config.dbCredentials.username,
      password: config.dbCredentials.password ?? '',
      database: config.dbCredentials.database,
    });
    const appliedByName = await tryLoadAppliedMigrationStatuses(client, config.migrations.table);

    spinner.succeed('Loaded migration status');

    const appliedCount = localMigrations.filter(migration => appliedByName?.get(migration.name)?.status === 'completed').length;
    const failedCount = localMigrations.filter(migration => appliedByName?.get(migration.name)?.status === 'failed').length;
    const pendingCount = localMigrations.length - appliedCount - failedCount;
    const mismatches = localMigrationFiles.filter(file => {
      const applied = appliedByName?.get(file.migrationName);
      return Boolean(applied?.checksum && applied.checksum !== file.checksum);
    });

    logger.kv([
      ['directory', path.relative(process.cwd(), migrationsOutDir)],
      ['latest', journal.latestSnapshotPath ?? 'none'],
      ['snapshots', String(journal.snapshots.length)],
      ['migrations', String(journal.migrations.length)],
      ['applied', String(appliedCount)],
      ['pending', String(pendingCount)],
      ['failed', String(failedCount)],
    ]);

    if (journal.migrations.length === 0) {
      logger.callout(appliedByName ? 'Connected State' : 'Local State Only', [
        'No local migrations are currently tracked.',
        appliedByName
          ? 'The ClickHouse migration table is reachable, but the local journal is empty.'
          : 'The ClickHouse migration table is not initialized yet.',
      ]);
      return;
    }

    logger.newline();
    logger.table(
      ['Migration', 'Kind', 'State', 'Checksum'],
      localMigrations
        .map((migration) => [
          migration.name,
          migration.kind === 'custom' ? 'custom SQL' : 'generated',
          renderStateLabel(appliedByName?.get(migration.name)?.status),
          renderChecksumLabel(
            localMigrationFiles.find(file => file.migrationName === migration.name)?.checksum,
            appliedByName?.get(migration.name)?.checksum,
          ),
        ]),
    );
    logger.newline();
    if (!appliedByName) {
      logger.callout('Local State Only', [
        'The ClickHouse migration table is not initialized yet.',
        'Run `hypequery migrate` to create it and begin recording applied state.',
      ]);
    } else if (mismatches.length > 0) {
      logger.callout('Checksum Warning', [
        `${mismatches.length} applied migration${mismatches.length === 1 ? '' : 's'} do not match the current local files.`,
        'Review the migration directory contents before applying further changes.',
      ]);
    } else {
      logger.callout('Connected State', [
        'Local journal state and recorded ClickHouse execution state were both inspected.',
      ]);
    }
  } catch (error) {
    spinner.fail('Failed to load migration status');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  } finally {
    await client?.close().catch(() => undefined);
  }
}

function renderStateLabel(status?: string): string {
  if (status === 'completed') {
    return 'applied';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'pending';
}

function renderChecksumLabel(localChecksum?: string, appliedChecksum?: string): string {
  if (!appliedChecksum) {
    return 'unrecorded';
  }
  if (!localChecksum) {
    return 'unknown';
  }
  return localChecksum === appliedChecksum ? 'ok' : 'mismatch';
}
