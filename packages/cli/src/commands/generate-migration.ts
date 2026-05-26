import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  createMigrationPlan,
  diffSnapshots,
  renderMigrationArtifacts,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  writeMigrationArtifacts,
} from '@hypequery/schema';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import { logger } from '../utils/logger.js';
import { assertValidMigrationSlug, createMigrationTimestamp, formatMigrationName } from '../utils/migration-names.js';
import { loadMigrationSchema } from '../utils/migration-schema.js';
import { writeMigrationChecksumFile } from '../utils/migration-checksums.js';
import {
  appendMigrationJournalEntry,
  assertMigrationDoesNotExist,
  readLatestMigrationSnapshot,
  writeCustomMigration,
  writeLatestMigrationSnapshot,
} from '../utils/migration-state.js';

export interface GenerateMigrationOptions {
  config?: string;
  custom?: boolean;
  timestamp?: string;
}

export async function generateMigrationCommand(
  migrationSlug: string | undefined,
  options: GenerateMigrationOptions = {},
) {
  logger.newline();
  logger.header('hypequery generate:migration');

  try {
    assertValidMigrationSlug(migrationSlug);

    const config = await loadHypequeryConfig(options.config);
    const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
    const timestamp = options.timestamp ?? createMigrationTimestamp();
    const migrationName = formatMigrationName(timestamp, migrationSlug);

    await assertMigrationDoesNotExist(migrationsOutDir, migrationName);

    const loadSpinner = ora('Loading migration config...').start();
    const previousSnapshot = await readLatestMigrationSnapshot(migrationsOutDir);
    loadSpinner.succeed('Loaded migration config');

    if (options.custom) {
      await writeCustomMigration({
        outDir: migrationsOutDir,
        migrationName,
        timestamp,
        previousSnapshot,
      });

      logger.success(`Created custom migration ${path.relative(process.cwd(), path.join(migrationsOutDir, migrationName))}`);
      logger.newline();
      return;
    }

    const schemaSpinner = ora('Loading schema...').start();
    const schema = await loadMigrationSchema(config.schema);
    const nextSnapshot = serializeSchemaToSnapshot(schema);
    schemaSpinner.succeed('Loaded schema');

    const planSpinner = ora('Planning migration...').start();
    const diff = diffSnapshots(previousSnapshot, nextSnapshot);
    const plan = createMigrationPlan(diff);

    if (plan.operations.length === 0) {
      planSpinner.succeed('No schema changes detected');
      logger.info('No migration was generated.');
      logger.newline();
      return;
    }

    const artifacts = renderMigrationArtifacts(plan, {
      name: migrationName,
      timestamp,
      cluster: config.cluster?.name,
    });
    planSpinner.succeed(`Planned ${plan.operations.length} operations`);

    const writeSpinner = ora('Writing migration files...').start();
    const written = await writeMigrationArtifacts({
      outDir: migrationsOutDir,
      migrationName,
      artifacts,
    });
    await writeFile(
      path.join(written.migrationDir, 'snapshot.json'),
      `${snapshotToStableJson(nextSnapshot)}\n`,
      'utf8',
    );
    const checksumFile = await writeMigrationChecksumFile(written.migrationDir);
    await writeLatestMigrationSnapshot(migrationsOutDir, nextSnapshot);
    await appendMigrationJournalEntry(migrationsOutDir, {
      name: migrationName,
      timestamp,
      custom: false,
      sourceSnapshotHash: plan.sourceSnapshotHash,
      targetSnapshotHash: plan.targetSnapshotHash,
      checksum: checksumFile.checksum,
    }, nextSnapshot.contentHash);
    writeSpinner.succeed('Wrote migration files');

    logger.success(`Created migration ${path.relative(process.cwd(), written.migrationDir)}`);
    if (artifacts.meta.unsafe || plan.requiredConfirmations.length > 0) {
      logger.warn('Migration contains operations that require review before execution.');
    }
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
