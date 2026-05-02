import path from 'node:path';
import ora from 'ora';
import { writeMigrationArtifacts } from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import { prepareMigrationArtifacts } from '../utils/migration-state.js';

export interface PlanOptions {
  name: string;
  config?: string;
}

export async function planCommand(options: PlanOptions): Promise<void> {
  logger.command('plan', 'Preview a migration without mutating journal state.');
  logger.phase('Preparing preview');

  const spinner = ora('Loading hypequery config...').start();

  try {
    const prepared = await prepareMigrationArtifacts(options);

    if (!prepared.artifacts) {
      spinner.succeed('Schema is already up to date');
      logger.callout('No Changes', [
        'No snapshot changes detected.',
        'No preview artifacts were written.',
      ]);
      return;
    }

    logger.phase('Writing preview artifacts');
    spinner.text = 'Writing migration preview...';
    const previewRoot = path.join(prepared.metaDir, '_plan');
    const writtenArtifacts = await writeMigrationArtifacts({
      outDir: previewRoot,
      migrationName: prepared.migrationName,
      artifacts: prepared.artifacts,
    });

    spinner.succeed(`Planned migration ${prepared.migrationName}`);
    logger.kv([
      ['migration', prepared.migrationName],
      ['preview', path.relative(process.cwd(), writtenArtifacts.migrationDir)],
    ]);
    logger.callout('Review Only', [
      'Journal state was not modified.',
      'This preview is safe to inspect or delete locally.',
    ]);
  } catch (error) {
    spinner.fail('Failed to create migration plan');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}
