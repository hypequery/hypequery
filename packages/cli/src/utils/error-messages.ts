import type { MigrationPlanBlocker, UnsupportedChange } from '@hypequery/schema';
import { logger } from './logger.js';

/**
 * Display error when queries file cannot be found
 * @param commandName - Name of the command for the usage example
 */
export function displayQueriesFileNotFoundError(commandName: string): void {
  logger.error('Could not find queries file');
  logger.newline();
  logger.info('Expected one of:');
  logger.indent('• analytics/queries.ts');
  logger.indent('• src/analytics/queries.ts');
  logger.indent('• hypequery.ts');
  logger.newline();
  logger.info("Did you run 'hypequery init'?");
  logger.newline();
  logger.info('Or specify the file explicitly:');
  logger.indent(`hypequery ${commandName} ./path/to/queries.ts`);
  logger.newline();
}

/**
 * Display error when migration is blocked by unsupported operations
 * @param blockers - List of blockers preventing migration generation
 */
export function displayBlockedMigrationError(blockers: MigrationPlanBlocker[]): void {
  logger.error('Cannot generate automatic migration');
  logger.newline();
  logger.info('The following operations are not supported:');
  logger.newline();

  for (const blocker of blockers) {
    logger.indent(`• ${blocker.message}`);
  }

  logger.newline();
  logger.info('To proceed with these changes:');
  logger.newline();
  logger.indent('1. Create a custom migration:');
  logger.indent('   hypequery generate:migration <name> --custom');
  logger.newline();
  logger.indent('2. Write the necessary SQL in the up.sql file');
  logger.newline();
  logger.indent('3. After deploying, run pull to reconcile:');
  logger.indent('   hypequery pull');
  logger.newline();
}

/**
 * Display guidance for unsupported change types
 * @param change - The unsupported change that was detected
 */
export function displayUnsupportedChangeError(change: UnsupportedChange): void {
  logger.error(`Unsupported change detected: ${change.kind}`);
  logger.newline();
  logger.info(change.message);
  logger.newline();

  switch (change.kind) {
    case 'PossibleColumnRename':
      logger.info('Column renames are not auto-detected to prevent accidental data loss.');
      logger.newline();
      logger.info('To rename a column:');
      logger.indent('1. Create a custom migration');
      logger.indent('2. Use: ALTER TABLE <table> RENAME COLUMN <old> TO <new>');
      break;

    case 'TableEngineChanged':
      logger.info('Table engine changes require manual intervention.');
      logger.newline();
      logger.info('Recommended approach:');
      logger.indent('1. Create new table with desired engine');
      logger.indent('2. Backfill data in batches');
      logger.indent('3. Swap tables atomically');
      logger.indent('4. Drop old table');
      break;

    case 'TableSettingsChanged':
      logger.info('Table settings changes are not yet auto-generated.');
      logger.newline();
      logger.info('Create a custom migration with:');
      logger.indent('ALTER TABLE <table> MODIFY SETTING <setting> = <value>');
      break;
  }

  logger.newline();
}
