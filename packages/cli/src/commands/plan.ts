import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { renderMigrationArtifacts } from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import { DEFAULT_HYPEQUERY_CONFIG_PATH } from '../utils/load-hypequery-config.js';
import {
  createTimestamp,
  ensureDir,
  prepareMigrationPipeline,
  slugifyMigrationName,
} from './migration-pipeline.js';

export interface PlanOptions {
  config?: string;
  name?: string;
}

export async function planCommand(options: PlanOptions = {}) {
  const configPath = options.config ?? DEFAULT_HYPEQUERY_CONFIG_PATH;
  const previewLabel = slugifyMigrationName(options.name) ?? 'plan';

  logger.newline();
  logger.header('hypequery plan');

  const pipeline = await prepareMigrationPipeline(configPath);
  const { config, migrationsMetaDir, diff } = pipeline;

  if (diff.operations.length === 0 && diff.unsupportedChanges.length === 0) {
    logger.success('No schema changes detected.');
    logger.newline();
    return;
  }

  const previewDir = path.join(migrationsMetaDir, 'plan-preview');
  const timestamp = createTimestamp();
  const spinner = ora('Writing plan preview...').start();

  try {
    const artifacts = renderMigrationArtifacts(diff, {
      name: previewLabel,
      timestamp,
      cluster: config.cluster?.name,
    });
    const plan = (artifacts as unknown as { plan: unknown }).plan;

    await ensureDir(previewDir);
    const upPath = path.join(previewDir, 'up.sql');
    const downPath = path.join(previewDir, 'down.sql');
    const metaPath = path.join(previewDir, 'meta.json');
    const planPath = path.join(previewDir, 'plan.json');

    await writeFile(upPath, `${artifacts.upSql}\n`, 'utf8');
    await writeFile(downPath, `${artifacts.downSql}\n`, 'utf8');
    await writeFile(metaPath, `${JSON.stringify(artifacts.meta, null, 2)}\n`, 'utf8');
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

    spinner.succeed('Wrote plan preview');
    logger.success(`Preview directory: ${path.relative(process.cwd(), previewDir)}`);
    logger.success(`SQL preview: ${path.relative(process.cwd(), upPath)}`);
    logger.success(`Plan JSON: ${path.relative(process.cwd(), planPath)}`);
    logger.info(`Planned ${artifacts.meta.operations.length} operation(s)`);
    if (artifacts.meta.unsafe) {
      logger.warn('Plan contains warnings or manual steps. Review plan.json and SQL carefully.');
    }
    logger.newline();
  } catch (error) {
    spinner.fail('Failed to write plan preview');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
