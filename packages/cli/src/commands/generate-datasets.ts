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
import { redactConnectionUrl } from '../utils/redact-connection-url.js';
import { logDatasetGenerationWarnings } from '../utils/dataset-generation-warnings.js';

export interface GenerateDatasetsOptions {
  output?: string;
  path?: string;
  tables?: string;
  excludeTables?: string;
  tenantColumn?: string;
}

/**
 * Turns the written path into something pasteable into an import statement:
 * strips the `.ts` extension and makes it explicitly relative.
 */
function toImportSpecifier(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.tsx?$/, '');
  const normalized = withoutExtension.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function parseTableList(value: string | undefined): string[] | undefined {
  const parsed = value
    ?.split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

export async function generateDatasetsCommand(options: GenerateDatasetsOptions = {}) {
  // Determine output path
  let outputPath: string;

  if (options.output) {
    outputPath = path.resolve(process.cwd(), options.output);
  } else if (options.path) {
    outputPath = path.resolve(process.cwd(), options.path, 'datasets.ts');
  } else {
    // Sibling of `hypequery generate`, which writes analytics/schema.ts. Keeping
    // both commands in one directory is what the docs have always described.
    outputPath = path.join(process.cwd(), 'analytics', 'datasets.ts');
  }

  const parsedTables = parseTableList(options.tables);
  const excludedTables = parseTableList(options.excludeTables);

  logger.newline();
  logger.header('hypequery generate datasets');

  const spinner = ora('Connecting to ClickHouse...').start();

  try {
    // Get table count
    const tableCount = await getTableCount('clickhouse');
    spinner.succeed('Connected to ClickHouse');

    logger.success(
      parsedTables
        ? `Found ${tableCount} tables, filtering to ${parsedTables.length}`
        : `Found ${tableCount} tables`,
    );

    // Generate datasets
    const datasetSpinner = ora('Generating dataset definitions...').start();

    const generated = await generateDatasets({
      outputPath,
      includeTables: parsedTables,
      excludeTables: excludedTables,
      // Regeneration replaces the whole file, so a tenant boundary configured at
      // init has to be restated here or it is dropped on every refresh.
      tenantColumn: options.tenantColumn,
    });

    const generatedTables = generated?.tables ?? parsedTables ?? [];
    const generatedCount = generatedTables.length || tableCount;
    datasetSpinner.succeed(
      `Generated dataset definitions for ${generatedCount} ${generatedCount === 1 ? 'table' : 'tables'}`,
    );

    const relativeOutput = path.relative(process.cwd(), outputPath);
    logger.success(`Created ${relativeOutput}`);
    logDatasetGenerationWarnings(generated?.warnings);

    logger.newline();
    logger.header('Next steps:');
    logger.indent('1. Review and customize the generated datasets');
    logger.indent('2. Import datasets in your application code');
    logger.indent('3. Create an analytics client and start querying!');
    logger.newline();

    // Built from what was actually written, so the snippet can be pasted as-is.
    const importPath = toImportSpecifier(relativeOutput);
    const firstTable = generatedTables[0] ?? 'orders';

    logger.info('Example usage:');
    logger.indent(`import { datasets } from '${importPath}';`);
    logger.indent('import { createDatasetClient } from \'@hypequery/datasets\';');
    logger.indent('import { createQueryBuilder } from \'@hypequery/clickhouse\';');
    logger.indent('');
    logger.indent('const db = createQueryBuilder({ url, username, password, database });');
    logger.indent('const analytics = createDatasetClient({ queryBuilder: db });');
    logger.indent(
      `const rowCount = datasets['${firstTable}'].metric('rowCount', { measure: 'totalCount' });`,
    );
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
        logger.indent('CLICKHOUSE_URL=' + redactConnectionUrl(
          process.env.CLICKHOUSE_URL || process.env.CLICKHOUSE_HOST,
        ));
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
