import path from 'node:path';
import ora from 'ora';
import {
  createMigrationPlan,
  diffSnapshots,
  renderMigrationArtifacts,
  serializeSchemaToSnapshot,
} from '@hypequery/schema';
import { createMigrationClickHouseClient } from '../utils/clickhouse-migration-introspection.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { applyMigrationSqlDirectly } from '../utils/migration-direct-apply.js';
import { createMigrationTimestamp } from '../utils/migration-names.js';
import { loadMigrationSchema } from '../utils/migration-schema.js';
import {
  readLatestMigrationSnapshot,
  writeLatestMigrationSnapshot,
} from '../utils/migration-state.js';

export interface PushOptions {
  config?: string;
}

export async function pushCommand(options: PushOptions = {}) {
  logger.newline();
  logger.header('hypequery push');

  try {
    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);

    logger.warn('Push is a development-only workflow. Do not use it for CI or production databases.');
    logger.warn('Push applies schema changes directly and does not write migration files or remote migration history.');

    const loadSpinner = ora('Loading schema state...').start();
    const previousSnapshot = await readLatestMigrationSnapshot(migrationsOutDir);
    const schema = await loadMigrationSchema(config.schema);
    const nextSnapshot = serializeSchemaToSnapshot(schema);
    loadSpinner.succeed('Loaded schema state');

    const planSpinner = ora('Planning direct schema push...').start();
    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot));

    if (plan.operations.length === 0) {
      planSpinner.succeed('No schema changes detected');
      logger.info('Nothing to push.');
      logger.newline();
      return;
    }

    const artifacts = renderMigrationArtifacts(plan, {
      name: 'push',
      timestamp: createMigrationTimestamp(),
      cluster: config.cluster?.name,
    });
    planSpinner.succeed(`Planned ${plan.operations.length} operations`);

    if (artifacts.meta.unsafe || plan.requiredConfirmations.length > 0) {
      logger.warn('Direct push includes operations that require careful review.');
    }

    const applySpinner = ora('Applying schema changes directly...').start();
    const client = createMigrationClickHouseClient(config.dbCredentials);
    try {
      const result = await applyMigrationSqlDirectly(client, artifacts.upSql);
      await writeLatestMigrationSnapshot(migrationsOutDir, nextSnapshot);
      applySpinner.succeed(`Applied ${result.appliedStepCount}/${result.totalSteps} statements`);
    } finally {
      await client.close();
    }

    logger.success('Pushed schema changes and updated latest migration snapshot.');
    logger.info('No migration file was written. Generate a migration for shared or production workflows.');
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
