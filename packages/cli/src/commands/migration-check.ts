import path from 'node:path';
import ora from 'ora';
import { createMigrationClickHouseClient } from '../utils/clickhouse-migration-introspection.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { fetchAppliedMigrationsIfTableExists } from '../utils/migration-remote-state.js';
import { verifyMigrationIntegrity } from '../utils/migration-checksums.js';
import { readMigrationJournal } from '../utils/migration-state.js';

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
    const [results, journal] = await Promise.all([
      verifyMigrationIntegrity(migrationsOutDir),
      readMigrationJournal(migrationsOutDir),
    ]);
    spinner.succeed('Checked migration files');

    if (results.length === 0) {
      logger.info('No local migrations found.');
      logger.newline();
      return;
    }

    const failures = results.filter(result => !result.ok);
    if (failures.length === 0) {
      const remoteSpinner = ora('Checking applied migration checksums...').start();
      const remoteResult = await checkRemoteMigrationChecksums({
        migrationTable: config.migrations.table,
        credentials: config.dbCredentials,
        journal,
      });
      remoteSpinner.succeed(remoteResult.checkedRemote
        ? 'Checked applied migration checksums'
        : 'Skipped applied migration checksums');

      if (remoteResult.warning) {
        logger.warn(remoteResult.warning);
      }

      if (remoteResult.mismatches.length > 0) {
        for (const mismatch of remoteResult.mismatches) {
          logger.warn(`${mismatch.name}: applied checksum does not match local files`);
        }
        throw new Error(`${remoteResult.mismatches.length} applied migration${remoteResult.mismatches.length === 1 ? '' : 's'} failed remote checksum checks.`);
      }

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

async function checkRemoteMigrationChecksums(input: {
  migrationTable: string;
  credentials: Parameters<typeof createMigrationClickHouseClient>[0];
  journal: Awaited<ReturnType<typeof readMigrationJournal>>;
}) {
  const client = createMigrationClickHouseClient(input.credentials);
  try {
    const applied = await fetchAppliedMigrationsIfTableExists({
      client,
      migrationTable: input.migrationTable,
    });
    const journalByName = new Map(input.journal.migrations.map(entry => [entry.name, entry]));
    return {
      checkedRemote: true,
      mismatches: applied.filter(entry => {
        const local = journalByName.get(entry.name);
        return entry.status === 'applied' && local?.checksum !== undefined && local.checksum !== entry.checksum;
      }),
    };
  } catch (error) {
    return {
      checkedRemote: false,
      mismatches: [],
      warning: `Remote migration state unavailable; checked local files only. ${formatError(error)}`,
    };
  } finally {
    await client.close();
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
