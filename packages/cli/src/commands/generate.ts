import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findSchemaFile } from '../utils/find-files.js';
import { getTableCount } from '../utils/detect-database.js';

export interface GenerateOptions {
  output?: string;
  tables?: string;
  watch?: boolean;
}

export async function generateCommand(options: GenerateOptions = {}) {
  // Determine output path
  let outputPath: string;

  if (options.output) {
    outputPath = path.resolve(process.cwd(), options.output);
  } else {
    // Try to find existing schema file
    const existingSchema = await findSchemaFile();
    if (existingSchema) {
      outputPath = existingSchema;
    } else {
      // Default to analytics/schema.ts
      outputPath = path.join(process.cwd(), 'analytics', 'schema.ts');
    }
  }

  logger.newline();
  logger.header('hypequery generate');

  const spinner = ora('Connecting to ClickHouse...').start();

  try {
    // Get table count
    const tableCount = await getTableCount('clickhouse');
    spinner.succeed(`Connected to ClickHouse`);

    logger.success(`Found ${tableCount} tables`);

    // Generate types
    const typeSpinner = ora('Generating types...').start();

    const { generateTypes } = await import('@hypequery/clickhouse/cli');

    await generateTypes(outputPath);

    typeSpinner.succeed(`Generated types for ${tableCount} tables`);

    logger.success(`Updated ${path.relative(process.cwd(), outputPath)}`);

    logger.newline();
    logger.header('Types regenerated successfully!');
    logger.newline();

    // Watch mode
    if (options.watch) {
      logger.info('Watching ClickHouse schema for changes...');
      logger.newline();

      // Poll for schema changes every 30 seconds
      let lastTableCount = tableCount;

      setInterval(async () => {
        const currentTableCount = await getTableCount('clickhouse');

        if (currentTableCount !== lastTableCount) {
          logger.newline();
          logger.reload(`Schema changed (${Math.abs(currentTableCount - lastTableCount)} ${currentTableCount > lastTableCount ? 'new' : 'removed'} tables)`);

          const regenerateSpinner = ora('Regenerating types...').start();

          await generateTypes(outputPath);

          regenerateSpinner.succeed('Regenerated types');
          logger.success(`Updated ${path.relative(process.cwd(), outputPath)}`);
          logger.newline();

          lastTableCount = currentTableCount;
        }
      }, 30000); // Check every 30 seconds

      // Keep process alive
      process.on('SIGINT', () => {
        logger.newline();
        logger.info('Stopping watch mode...');
        process.exit(0);
      });
    }
  } catch (error) {
    spinner.fail('Failed to generate types');
    logger.newline();

    if (error instanceof Error) {
      logger.error(error.message);

      if (error.message.includes('ECONNREFUSED')) {
        logger.newline();
        logger.info('This usually means:');
        logger.indent('• ClickHouse is not running');
        logger.indent('• Wrong host/port in configuration');
        logger.indent('• Firewall blocking connection');
        logger.newline();
        logger.info('Check your configuration:');
        logger.indent('CLICKHOUSE_HOST=' + (process.env.CLICKHOUSE_HOST || 'not set'));
        logger.newline();
        logger.info('Docs: https://hypequery.com/docs/troubleshooting#connection-errors');
      }
    } else {
      logger.error(String(error));
    }

    logger.newline();
    process.exit(1);
  }
}
