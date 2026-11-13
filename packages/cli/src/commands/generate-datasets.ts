import { CliError, isCliError, outOfDateError, outputConflictError } from '../utils/cli-error.js';
import { emitResult } from '../utils/machine-output.js';
import { exitWith } from '../utils/command-exit.js';
import { telemetryErrorCode } from '../utils/telemetry/error-code.js';
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
import { describeConnectionError } from '../utils/connection-error.js';
import { generateDatasets } from '../generators/dataset-generator.js';
import { redactConnectionUrl } from '../utils/redact-connection-url.js';
import { logDatasetGenerationWarnings } from '../utils/dataset-generation-warnings.js';
import { formatGeneratedFileDiff } from '../utils/generated-file-diff.js';
import { readGeneratedFile, writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { updateCommandTelemetry, setCommandTelemetryError } from '../utils/telemetry/command-context.js';
import { countBucket } from '../utils/telemetry/buckets.js';
import { warningBuckets } from '../utils/telemetry/generation-metrics.js';

export interface GenerateDatasetsOptions {
  output?: string;
  path?: string;
  tables?: string;
  excludeTables?: string;
  tenantColumn?: string;
  force?: boolean;
  check?: boolean;
  diff?: boolean;
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

function refuseOverwrite(relativeOutput: string): never {
  throw outputConflictError(
    `Refusing to overwrite existing dataset definitions: ${relativeOutput}. Run again with --diff to inspect changes or --force to replace the file.`,
    [relativeOutput],
    'Run again with --diff to inspect changes or --force to replace the file.',
  );
}

function parseTableList(value: string | undefined): string[] | undefined {
  const parsed = value
    ?.split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

export async function generateDatasetsCommand(options: GenerateDatasetsOptions = {}) {
  updateCommandTelemetry('generate:datasets', { mode: options.check ? 'check' : options.diff ? 'diff' : 'write', force: !!options.force,
    tenant_column_used: !!options.tenantColumn, tables_filter_used: !!options.tables, exclude_filter_used: !!options.excludeTables });
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

  if (options.force && (options.check || options.diff)) {
    setCommandTelemetryError('validation_failed');
    throw new CliError('USAGE', '--force cannot be combined with --check or --diff.', {
      hint: 'Use --force to write, or --check / --diff to compare, not both.',
    });
  }

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
      writeOutput: false,
    });

    const generatedTables = generated?.tables ?? parsedTables ?? [];
    const generatedCount = generatedTables.length || tableCount;
    datasetSpinner.succeed(
      `Generated dataset definitions for ${generatedCount} ${generatedCount === 1 ? 'table' : 'tables'}`,
    );

    logDatasetGenerationWarnings(generated?.warnings);
    updateCommandTelemetry('generate:datasets', { datasets_generated_bucket: countBucket(generated.tables.length), warning_counts: warningBuckets(generated.warnings) });

    const relativeOutput = path.relative(process.cwd(), outputPath);
    const report = (status: 'up_to_date' | 'unchanged' | 'created' | 'updated') => emitResult({
      status,
      output: outputPath,
      tables: generated.tables,
      warnings: generated.warnings ?? [],
    });
    const currentContents = await readGeneratedFile(outputPath);
    const contentsMatch = currentContents === generated.contents;
    if (options.check) {
      const result = contentsMatch ? 'up_to_date' : currentContents === undefined ? 'missing' : 'out_of_date';
      updateCommandTelemetry('generate:datasets', { check_result: result });
      if (!contentsMatch) setCommandTelemetryError(currentContents === undefined ? 'output_missing' : 'output_out_of_date');
    }

    if (contentsMatch) {
      logger.success(
        options.check || options.diff
          ? `Dataset definitions are up to date: ${relativeOutput}`
          : `Unchanged ${relativeOutput}`,
      );
      if (options.check || options.diff) {
        report('up_to_date');
        return;
      }
    } else if (options.diff) {
      setCommandTelemetryError('output_out_of_date');
      const diff = formatGeneratedFileDiff(currentContents ?? '', generated.contents, relativeOutput);
      logger.raw(diff);
      throw new CliError('OUT_OF_DATE', `Generated dataset definitions differ: ${relativeOutput}`, {
        category: 'stale_contract',
        telemetryCode: 'output_out_of_date',
        hint: 'Review the diff, then rerun with --force to write the new definitions.',
        issues: [{ path: relativeOutput, message: diff }],
      });
    } else if (options.check) {
      throw outOfDateError(
        currentContents === undefined
          ? `Dataset definitions are missing: ${relativeOutput}`
          : `Generated dataset definitions are out of date: ${relativeOutput}`,
        [{ path: relativeOutput, missing: currentContents === undefined }],
        'Run the command with --diff to inspect the changes, then with --force to write them.',
      );
    } else if (currentContents !== undefined && !options.force) {
      refuseOverwrite(relativeOutput);
    } else {
      try {
        // Without --force this is an exclusive create, so a file written
        // between the read above and here is refused rather than clobbered.
        await writeGeneratedFileAtomically(outputPath, generated.contents, {
          overwrite: options.force === true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          refuseOverwrite(relativeOutput);
        }
        throw error;
      }
      logger.success(
        currentContents === undefined
          ? `Created ${relativeOutput}`
          : `Updated ${relativeOutput}`,
      );
    }

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
    report(contentsMatch ? 'unchanged' : currentContents === undefined ? 'created' : 'updated');

  } catch (error) {
    if (isCliError(error)) throw error;
    spinner.fail('Failed to generate datasets');
    logger.newline();

    if (error instanceof Error) {
      const message = describeConnectionError(error);
      logger.error(message);

      // Provide specific guidance
      if (message.includes('ECONNREFUSED')) {
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
      } else if (message.includes('No tables found')) {
        logger.newline();
        logger.info('No tables match the specified criteria');
        logger.indent('Try: hypequery generate datasets --tables table1,table2');
      }
    } else {
      logger.error(String(error));
    }

    logger.newline();
    exitWith(1, 'failure', telemetryErrorCode(error));
  }
}
