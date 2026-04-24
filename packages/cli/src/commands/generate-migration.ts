import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  renderMigrationArtifacts,
  snapshotToStableJson,
  writeMigrationArtifacts,
} from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_HYPEQUERY_CONFIG_PATH,
} from '../utils/load-hypequery-config.js';
import {
  createTimestamp,
  ensureDir,
  prepareMigrationPipeline,
  slugifyMigrationName,
} from './migration-pipeline.js';

export interface GenerateMigrationOptions {
  config?: string;
  name?: string;
}

export async function generateMigrationCommand(options: GenerateMigrationOptions = {}) {
  const configPath = options.config ?? DEFAULT_HYPEQUERY_CONFIG_PATH;
  const slug = slugifyMigrationName(options.name);

  if (!slug) {
    logger.error('Missing migration name. Use --name <migration-name>.');
    process.exit(1);
  }

  logger.newline();
  logger.header('hypequery generate:migration');

  const pipeline = await prepareMigrationPipeline(configPath);
  const { config, migrationsOutDir, migrationsMetaDir, nextSnapshot, diff } = pipeline;
  if (diff.operations.length === 0 && diff.unsupportedChanges.length === 0) {
    logger.success('No schema changes detected.');
    logger.newline();
    return;
  }

  const timestamp = createTimestamp();
  const migrationName = `${timestamp}_${slug}`;

  const writeSpinner = ora('Writing migration artifacts...').start();

  try {
    const artifacts = renderMigrationArtifacts(diff, {
      name: slug,
      timestamp,
      cluster: config.cluster?.name,
    });
    const written = await writeMigrationArtifacts({
      outDir: migrationsOutDir,
      migrationName,
      artifacts,
    });
    await ensureDir(migrationsMetaDir);
    const snapshotPath = path.join(migrationsMetaDir, `${migrationName}_snapshot.json`);
    await writeFile(snapshotPath, `${snapshotToStableJson(nextSnapshot)}\n`, 'utf8');

    writeSpinner.succeed(`Wrote migration ${migrationName}`);
    logger.success(`Migration directory: ${path.relative(process.cwd(), written.migrationDir)}`);
    logger.success(`Snapshot: ${path.relative(process.cwd(), snapshotPath)}`);
    logger.info(`Planned ${artifacts.meta.operations.length} operation(s)`);
    if (artifacts.meta.unsafe) {
      logger.warn('Migration contains warnings or manual steps. Review plan.json and SQL carefully.');
    }
    logger.newline();
  } catch (error) {
    writeSpinner.fail('Failed to write migration artifacts');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
