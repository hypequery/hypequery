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
import { displayBlockedMigrationError, displayUnsupportedChangeError } from '../utils/error-messages.js';
import { confirmDestructiveOperation, confirmMutationOperation } from '../utils/prompts.js';
import { gatherCostContext } from '../utils/migration-cost-analysis.js';
import { createMigrationClickHouseClient } from '../utils/clickhouse-migration-introspection.js';

export interface GenerateMigrationOptions {
  config?: string;
  custom?: boolean;
  timestamp?: string;
  force?: boolean;
  skipCostAnalysis?: boolean;
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

    if (diff.operations.length === 0) {
      planSpinner.succeed('No schema changes detected');
      logger.info('No migration was generated.');
      logger.newline();
      return;
    }

    // Gather cost context from ClickHouse (opt-out)
    let context;
    if (config.dbCredentials && !options.skipCostAnalysis) {
      try {
        planSpinner.text = 'Analyzing table statistics...';
        const client = createMigrationClickHouseClient(config.dbCredentials);
        context = await gatherCostContext(client, diff);
        await client.close();
      } catch (error) {
        // Graceful degradation - proceed without cost context
        planSpinner.warn('Could not analyze costs - proceeding without context');
      }
    }

    // Create plan with cost context and mutation confirmations enabled
    const plan = createMigrationPlan(diff, {
      context,
      requireConfirmationForMutations: true,
    });

    planSpinner.succeed(`Planned ${plan.operations.length} operations`);

    // Check for blockers that prevent migration generation
    if (plan.blockers.length > 0) {
      logger.newline();
      displayBlockedMigrationError(plan.blockers);

      // Show unsupported change guidance if applicable
      for (const change of diff.unsupportedChanges) {
        displayUnsupportedChangeError(change);
      }

      process.exit(1);
    }

    // Display detailed diagnostics for all warnings
    if (plan.diagnostics.length > 0) {
      logger.newline();
      logger.warn('Migration contains operations that require review:');
      logger.newline();

      for (const diagnostic of plan.diagnostics) {
        const icon = diagnostic.level === 'error' ? '✗' : '⚠';
        logger.indent(`${icon} ${diagnostic.message}`);
      }
      logger.newline();
    }

    // Prompt for confirmation on destructive operations (unless --force)
    const destructiveOps = plan.diagnostics.filter(
      d => d.kind === 'DestructiveDropTable' || d.kind === 'DestructiveDropColumn',
    );

    if (destructiveOps.length > 0 && !options.force) {
      const confirmed = await confirmDestructiveOperation(
        destructiveOps.map(d => d.message),
      );

      if (!confirmed) {
        logger.info('Migration generation cancelled');
        logger.newline();
        process.exit(0);
      }
    }

    // Prompt for confirmation on mutation operations (unless --force)
    if (
      plan.requiredConfirmations.some(c => c.kind === 'MutationRequiresConfirmation') &&
      !options.force
    ) {
      const confirmed = await confirmMutationOperation();

      if (!confirmed) {
        logger.info('Migration generation cancelled');
        logger.newline();
        process.exit(0);
      }
    }

    const artifacts = renderMigrationArtifacts(plan, {
      name: migrationName,
      timestamp,
      cluster: config.cluster?.name,
    });

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
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
