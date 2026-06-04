/**
 * Generate Datasets Command
 *
 * Auto-generates dataset definitions from ClickHouse schema.
 * Reduces quickstart friction by scaffolding the semantic layer.
 */

import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { getTableCount } from '../utils/detect-database.js';
import { generateDatasets } from '../generators/dataset-generator.js';

export interface GenerateDatasetsOptions {
  output?: string;
  tables?: string;
}

export async function generateDatasetsCommand(options: GenerateDatasetsOptions = {}) {
  // Determine output path
  let outputPath: string;

  if (options.output) {
    outputPath = path.resolve(process.cwd(), options.output);
  } else {
    // Default to src/datasets/generated.ts
    outputPath = path.join(process.cwd(), 'src', 'datasets', 'generated.ts');
  }

  const parsedTables = options.tables
    ? options.tables
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean)
    : undefined;

  logger.newline();
  logger.header('hypequery generate datasets');

  const spinner = ora('Connecting to ClickHouse...').start();

  try {
    // Get table count
    const tableCount = await getTableCount('clickhouse');
    spinner.succeed('Connected to ClickHouse');

    logger.success(`Found ${tableCount} tables`);

    // Generate datasets
    const datasetSpinner = ora('Generating dataset definitions...').start();

    await generateDatasets({
      outputPath,
      includeTables: parsedTables,
    });

    datasetSpinner.succeed(`Generated dataset definitions for ${parsedTables?.length || tableCount} tables`);

    logger.success(`Created ${path.relative(process.cwd(), outputPath)}`);

    logger.newline();
    logger.header('Next steps:');
    logger.indent('1. Review and customize the generated datasets');
    logger.indent('2. Import datasets in your application code');
    logger.indent('3. Create an analytics client and start querying!');
    logger.newline();

    logger.info('Example usage:');
    logger.indent('import { datasets } from \'./datasets/generated\';');
    logger.indent('import { createDatasetClient } from \'@hypequery/datasets\';');
    logger.indent('import { createBackend } from \'@hypequery/clickhouse\';');
    logger.indent('');
    logger.indent('const rowCount = datasets.orders.metric(\'rowCount\', { measure: \'totalCount\' });');
    logger.indent('const analytics = createDatasetClient({');
    logger.indent('  backend: createBackend({ url, username, password, database })');
    logger.indent('});');
    logger.indent('const result = await analytics.execute(rowCount);');
    logger.newline();

  } catch (error) {
    spinner.fail('Failed to generate datasets');
    logger.newline();

    if (error instanceof Error) {
      logger.error(error.message);

      // Provide specific guidance
      if (error.message.includes('ECONNREFUSED')) {
        logger.newline();
        logger.info('This usually means:');
        logger.indent('• ClickHouse is not running');
        logger.indent('• Wrong host/port in configuration');
        logger.indent('• Firewall blocking connection');
        logger.newline();
        logger.info('Check your configuration:');
        logger.indent('CLICKHOUSE_URL=' + (process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST || 'not set'));
      } else if (error.message.includes('No tables found')) {
        logger.newline();
        logger.info('No tables match the specified criteria');
        logger.indent('Try: hypequery generate datasets --tables table1,table2');
      }
    } else {
      logger.error(String(error));
    }

    logger.newline();
    process.exit(1);
  }
}
