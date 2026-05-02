import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import {
  snapshotToStableJson,
  writeMigrationArtifacts,
} from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import { loadHypequeryConfig } from '../utils/load-hypequery-config.js';
import {
  formatTimestamp,
  loadLatestSnapshotFromJournal,
  loadMigrationJournal,
  normalizeMigrationSlug,
  prepareMigrationArtifacts,
  recordCustomMigration,
  recordGeneratedMigration,
  SNAPSHOT_FILE_SUFFIX,
  writeMigrationJournal,
} from '../utils/migration-state.js';

export interface GenerateMigrationOptions {
  name: string;
  config?: string;
  custom?: boolean;
}

export async function generateMigrationCommand(options: GenerateMigrationOptions): Promise<void> {
  logger.command('generate:migration', 'Create reviewable migration artifacts from the managed schema.');
  logger.phase(options.custom ? 'Scaffolding custom migration' : 'Preparing migration plan');

  const spinner = ora('Loading hypequery config...').start();

  try {
    if (options.custom) {
      await generateCustomMigration(options, spinner);
      return;
    }

    const prepared = await prepareMigrationArtifacts(options);

    if (!prepared.artifacts) {
      spinner.succeed('Schema is already up to date');
      logger.callout('No Changes', [
        'No snapshot changes detected.',
        'No migration artifacts were written.',
      ]);
      return;
    }

    logger.phase('Writing artifacts');
    spinner.text = 'Writing migration artifacts...';
    const writtenArtifacts = await writeMigrationArtifacts({
      outDir: prepared.migrationsOutDir,
      migrationName: prepared.migrationName,
      artifacts: prepared.artifacts,
    });

    await mkdir(prepared.metaDir, { recursive: true });
    const snapshotFileName = `${prepared.migrationName}${SNAPSHOT_FILE_SUFFIX}`;
    const snapshotPath = path.join(prepared.metaDir, snapshotFileName);
    await writeFile(snapshotPath, `${snapshotToStableJson(prepared.nextSnapshot)}\n`, 'utf8');

    const createdAt = new Date().toISOString();
    const journal = recordGeneratedMigration(prepared.journal, {
      migrationName: prepared.migrationName,
      timestamp: prepared.timestamp,
      snapshotFileName,
      snapshotHash: prepared.nextSnapshot.contentHash,
      createdAt,
    });
    const journalPath = await writeMigrationJournal(prepared.metaDir, journal);

    spinner.succeed(`Created migration ${prepared.migrationName}`);
    logger.kv([
      ['migration', prepared.migrationName],
      ['artifacts', path.relative(process.cwd(), writtenArtifacts.migrationDir)],
      ['snapshot', path.relative(process.cwd(), snapshotPath)],
      ['journal', path.relative(process.cwd(), journalPath)],
    ]);
  } catch (error) {
    spinner.fail('Failed to generate migration');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    process.exit(1);
  }
}

async function generateCustomMigration(
  options: GenerateMigrationOptions,
  spinner: ReturnType<typeof ora>,
): Promise<void> {
  const config = await loadHypequeryConfig(options.config);
  const timestamp = formatTimestamp(new Date());
  const migrationName = `${timestamp}_${normalizeMigrationSlug(options.name)}`;
  const migrationsOutDir = path.resolve(process.cwd(), config.migrations.out);
  const metaDir = path.join(migrationsOutDir, 'meta');
  const migrationDir = path.join(migrationsOutDir, migrationName);
  const journal = await loadMigrationJournal(metaDir);
  const latestSnapshot = await loadLatestSnapshotFromJournal(metaDir, journal);
  const snapshotHash = latestSnapshot?.contentHash ?? 'untracked';

  logger.phase('Writing custom SQL scaffold');
  spinner.text = 'Writing custom migration scaffold...';
  await mkdir(migrationDir, { recursive: true });

  const upPath = path.join(migrationDir, 'up.sql');
  const downPath = path.join(migrationDir, 'down.sql');
  const metaPath = path.join(migrationDir, 'meta.json');
  const planPath = path.join(migrationDir, 'plan.json');

  await writeFile(
    upPath,
    [
      '-- Write custom ClickHouse SQL here.',
      '-- Custom migrations bypass automatic schema diffing.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    downPath,
    [
      '-- Provide a manual rollback if one exists.',
      '-- Leave this file as guidance if rollback is not safe or not possible.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    metaPath,
    `${JSON.stringify({
      name: migrationName,
      timestamp,
      operations: [],
      sourceSnapshotHash: snapshotHash,
      targetSnapshotHash: snapshotHash,
      custom: true,
      unsafe: true,
      containsManualSteps: true,
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    planPath,
    `${JSON.stringify({
      custom: true,
      note: 'Custom SQL migrations bypass automatic planning and do not advance the managed schema snapshot.',
      sourceSnapshotHash: snapshotHash,
      targetSnapshotHash: snapshotHash,
    }, null, 2)}\n`,
    'utf8',
  );

  const updatedJournal = recordCustomMigration(journal, {
    migrationName,
    timestamp,
    createdAt: new Date().toISOString(),
  });
  const journalPath = await writeMigrationJournal(metaDir, updatedJournal);

  spinner.succeed(`Created custom migration ${migrationName}`);
  logger.kv([
    ['migration', migrationName],
    ['kind', 'custom'],
    ['artifacts', path.relative(process.cwd(), migrationDir)],
    ['journal', path.relative(process.cwd(), journalPath)],
  ]);
  logger.callout('Follow-up', [
    'Custom migrations do not advance the managed schema snapshot.',
    'If the schema changed, run a new baseline or reconciliation flow later.',
  ]);
}
