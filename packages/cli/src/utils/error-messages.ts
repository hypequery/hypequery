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
