import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findSchemaFile } from '../utils/find-files.js';
import { detectDatabase, getTableCount, type DatabaseType } from '../utils/detect-database.js';
import { getTypeGenerator } from '../generators/index.js';

export interface GenerateOptions {
  output?: string;
  tables?: string;
  database?: DatabaseType;
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

  const parsedTables = options.tables
    ? options.tables
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean)
    : undefined;

  const requestedDbType = options.database as DatabaseType | undefined;
  const dbType = requestedDbType ?? (await detectDatabase());

  logger.newline();
  logger.header('hypequery generate');

  const spinner = ora(`Connecting to ${dbType}...`).start();

  try {
    const generator = getTypeGenerator(dbType);

    // Get table count
    const tableCount = await getTableCount(dbType);
    spinner.succeed(`Connected to ${dbType === 'clickhouse' ? 'ClickHouse' : dbType}`);

    logger.success(`Found ${tableCount} tables`);

    // Generate types
    const typeSpinner = ora('Generating types...').start();

    await generator({
      outputPath,
      includeTables: parsedTables,
    });

    typeSpinner.succeed(`Generated types for ${tableCount} tables`);

    logger.success(`Updated ${path.relative(process.cwd(), outputPath)}`);

    logger.newline();
    logger.header('Types regenerated successfully!');
    logger.newline();

  } catch (error) {
    spinner.fail('Failed to generate types');
    logger.newline();

    if (error instanceof Error) {
      logger.error(error.message);

      // Provide specific guidance based on error type
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
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        logger.newline();
        logger.info('Database connection timed out');
        logger.newline();
        logger.info('This usually means:');
        logger.indent('• Database is running but not responding');
        logger.indent('• Network latency is too high');
        logger.indent('• Firewall is dropping packets');
        logger.newline();
        logger.info('Try:');
        logger.indent('• Check if database is under heavy load');
        logger.indent('• Verify network connectivity');
        logger.indent('• Check firewall rules');
      } else if (error.message.toLowerCase().includes('ssl') || error.message.toLowerCase().includes('tls')) {
        logger.newline();
        logger.info('SSL/TLS connection error');
        logger.newline();
        logger.info('This usually means:');
        logger.indent('• SSL certificate validation failed');
        logger.indent('• Incorrect SSL configuration');
        logger.newline();
        logger.info('Try:');
        logger.indent('• Check if your connection string requires SSL');
        logger.indent('• Verify SSL certificate is valid');
        logger.indent('• Check SSL-related environment variables');
      } else if (error.message.toLowerCase().includes('authentication') || error.message.toLowerCase().includes('auth')) {
        logger.newline();
        logger.info('Authentication failed');
        logger.newline();
        logger.info('This usually means:');
        logger.indent('• Invalid username or password');
        logger.indent('• User does not have required permissions');
        logger.newline();
        logger.info('Check your configuration:');
        logger.indent('CLICKHOUSE_USERNAME=' + (process.env.CLICKHOUSE_USERNAME || 'not set'));
        logger.indent('CLICKHOUSE_PASSWORD=' + (process.env.CLICKHOUSE_PASSWORD ? '***' : 'not set'));
      }
    } else {
      logger.error(String(error));
    }

    logger.newline();
    process.exit(1);
  }
}
