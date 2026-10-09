import { countBucket } from '../utils/telemetry/buckets.js';
import { normalizeInitDatabase, normalizeInitStyle, normalizeAuthMode, parseTableList } from '../utils/init-options.js';
import { getChdbGitignoreEntry } from '../utils/chdb-gitignore-entry.js';
import { InitFunnel } from '../utils/telemetry/init-funnel.js';
import { exitWith } from '../utils/command-exit.js';
import { telemetryErrorCode } from '../utils/telemetry/error-code.js';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import {
  promptClickHouseConnection,
  promptInitDatabase,
  promptChdbStorage,
  promptOutputDirectory,
  promptInitStyle,
  promptInitAuthMode,
  promptGenerateExample,
  promptTableSelection,
  promptDatasetTableSelection,
  confirmWithoutPackageJson,
  confirmOverwrite,
  promptRetry,
  promptContinueWithoutDb,
  type InitStyle,
} from '../utils/prompts.js';
import {
  validateConnection,
  getTableCount,
  getTables,
} from '../utils/detect-database.js';
import {
  ChdbNotInstalledError,
  ensureChdbInstalled,
  getChdbTypeGenerationClient,
} from '../utils/chdb-client.js';
import { hasEnvFile, hasGitignore } from '../utils/find-files.js';
import { generateEnvTemplate, appendToEnv } from '../templates/env.js';
import { generateClientTemplate } from '../templates/client.js';
import { generateQueriesTemplate, type AuthTemplateMode } from '../templates/queries.js';
import { generateApiTemplate } from '../templates/api.js';
import { generateCloudTemplate } from '../templates/cloud.js';
import { CONTEXT_AUTH_TENANT_COLUMN } from '../templates/auth-scaffold.js';
import { generateDatasetsPlaceholderTemplate } from '../templates/datasets.js';
import { appendToGitignore } from '../templates/gitignore.js';
import { getTypeGenerator } from '../generators/index.js';
import { generateDatasets } from '../generators/dataset-generator.js';
import { installScaffoldDependencies } from '../utils/dependency-installer.js';
import { logDatasetGenerationWarnings } from '../utils/dataset-generation-warnings.js';
import { formatRegenerateDatasetsCommand } from '../utils/regenerate-datasets-command.js';

export interface InitOptions {
  path?: string;
  style?: InitStyle;
  database?: string;
  chdbPath?: string;
  allTables?: boolean;
  tables?: string;
  excludeTables?: string;
  noExample?: boolean;
  noInteractive?: boolean;
  force?: boolean;
  skipConnection?: boolean;
  auth?: AuthTemplateMode;
}

type ConnectionConfig = {
  host: string;
  database: string;
  username: string;
  password: string;
};

async function resolveConnectionConfig(options: InitOptions): Promise<ConnectionConfig | null> {
  if (options.noInteractive) {
    const required = (keys: string | string[]): string => {
      const values = Array.isArray(keys) ? keys : [keys];
      const value = values.map((key) => process.env[key]).find(Boolean);
      if (!value) {
        throw new Error(
          `Missing ${values.join(' or ')}. Provide ClickHouse connection info via environment variables when using --no-interactive.`,
        );
      }
      return value;
    };

    return {
      host: required(['CLICKHOUSE_URL', 'CLICKHOUSE_HOST']),
      database: required('CLICKHOUSE_DATABASE'),
      username: required(['CLICKHOUSE_USERNAME', 'CLICKHOUSE_USER']),
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
    };
  }

  return promptClickHouseConnection();
}

async function hasProjectPackageJson(): Promise<boolean> {
  try {
    await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

type ChdbTestResult = { ok: true; tableCount: number } | { ok: false; reason: 'not-installed' | 'engine-error' };

async function testChdbConnection(chdbPath: string | undefined): Promise<ChdbTestResult> {
  const spinner = ora('Starting embedded chDB...').start();

  try {
    await ensureChdbInstalled();
  } catch (error) {
    const isNotInstalled = error instanceof ChdbNotInstalledError;
    spinner.fail(isNotInstalled ? 'chdb is not installed' : 'Embedded chDB failed to load');
    logger.newline();
    logger.error(error instanceof Error ? error.message : String(error));
    logger.newline();
    return { ok: false, reason: isNotInstalled ? 'not-installed' : 'engine-error' };
  }

  const isValid = await validateConnection('chdb', { chdbPath });
  if (!isValid) {
    spinner.fail('Embedded chDB failed to run a query');
    logger.newline();
    logger.info('Common issues:');
    logger.indent('• Unsupported platform (chdb ships linux/macOS binaries; Windows needs WSL2)');
    logger.indent(`• The session directory is locked by another process${chdbPath ? ` (${chdbPath})` : ''}`);
    logger.newline();
    return { ok: false, reason: 'engine-error' };
  }

  const tableCount = await getTableCount('chdb', { chdbPath });
  spinner.succeed(
    `Embedded chDB ready (${chdbPath ? `${tableCount} tables in ${chdbPath}` : 'in-memory session'})`,
  );
  logger.newline();
  return { ok: true, tableCount };
}

async function testConnection(
  connectionConfig: ConnectionConfig,
): Promise<{ hasValidConnection: boolean; tableCount: number }> {
  const spinner = ora('Testing connection...').start();
  process.env.CLICKHOUSE_URL = connectionConfig.host;
  process.env.CLICKHOUSE_HOST = connectionConfig.host;
  process.env.CLICKHOUSE_DATABASE = connectionConfig.database;
  process.env.CLICKHOUSE_USERNAME = connectionConfig.username;
  process.env.CLICKHOUSE_PASSWORD = connectionConfig.password;

  const isValid = await validateConnection('clickhouse');

  if (!isValid) {
    spinner.fail('Connection failed');
    logger.newline();
    logger.error(`Could not connect to ClickHouse at ${connectionConfig.host}`);
    logger.newline();
    logger.info('Common issues:');
    logger.indent('• Check your host URL includes http:// or https://');
    logger.indent('• Verify username and password');
    logger.indent('• Ensure database exists');
    logger.indent('• Check firewall/network access');
    logger.newline();
    return { hasValidConnection: false, tableCount: 0 };
  }

  const tableCount = await getTableCount('clickhouse');
  spinner.succeed(`Connected successfully (${tableCount} tables found)`);
  logger.newline();
  return { hasValidConnection: true, tableCount };
}

export async function initCommand(options: InitOptions = {}) {
  const funnel = new InitFunnel({
    interactive: !(options.noInteractive === true || (options as InitOptions & { interactive?: boolean }).interactive === false),
    force: options.force === true,
    skip_connection: options.skipConnection === true,
  });
  try {
    await runInit(options, funnel);
  } catch (error) {
    funnel.fail(error);
    throw error;
  }
}

async function runInit(options: InitOptions, funnel: InitFunnel): Promise<void> {
  const noInteractive = options.noInteractive === true || (options as InitOptions & { interactive?: boolean }).interactive === false;

  logger.newline();
  logger.header('Welcome to hypequery!');

  const packageJsonPresent = await hasProjectPackageJson();
  funnel.update({ package_json_present: packageJsonPresent });
  if (!noInteractive && !packageJsonPresent) {
    logger.warn(`package.json not found in ${process.cwd()}`);
    const shouldContinue = await confirmWithoutPackageJson(process.cwd());
    if (!shouldContinue) {
      logger.info('Setup cancelled. Run init from your project directory.');
      funnel.cancel();
      return;
    }
    logger.newline();
  }

  funnel.attempt('database_selected');
  const database = normalizeInitDatabase(
    options.database ?? (noInteractive ? undefined : await promptInitDatabase()),
  );
  funnel.update({ database });
  funnel.reach('database_selected');
  funnel.attempt('connection_tested');
  logger.info(
    database === 'chdb'
      ? "Let's set up your analytics layer on embedded ClickHouse (chDB)."
      : "Let's set up your analytics layer.",
  );
  logger.newline();

  // Step 2: Get connection details
  let connectionConfig: ConnectionConfig | null = null;
  let hasValidConnection = false;
  let chdbPath = options.chdbPath;
  let chdbFailureReason: 'not-installed' | 'engine-error' | undefined;

  if (database === 'chdb') {
    // No server, no credentials — the only connection question is where the
    // embedded session stores its data.
    if (!chdbPath && !noInteractive) {
      chdbPath = await promptChdbStorage();
    }

  } else {
    connectionConfig = await resolveConnectionConfig(options);

    // Handle user skipping connection details
    if (!connectionConfig) {
      funnel.update({ connection_result: 'skipped' });
      logger.info('Skipping database connection for now.');
      logger.newline();
    } else if (options.skipConnection) {
      funnel.update({ connection_result: 'skipped' });
      logger.info('Skipping database connection test (requested).');
      logger.newline();
    } else {
      const { hasValidConnection: valid, tableCount } = await testConnection(connectionConfig);
      hasValidConnection = valid;
      funnel.update({ connection_result: valid ? 'ok' : 'failed', ...(valid ? { table_count_bucket: countBucket(tableCount) } : {}) });

      if (!hasValidConnection) {
        if (noInteractive) {
          throw new Error('Failed to connect to ClickHouse in non-interactive mode. Check your environment variables or use interactive setup.');
        }

        const retry = await promptRetry('Try again?');
        if (retry) {
          return runInit({ ...options, database }, funnel);
        }

        const continueWithout = await promptContinueWithoutDb();
        if (!continueWithout) {
          logger.info('Setup cancelled');
          exitWith(0, 'cancelled');
        }

        logger.newline();
        logger.info('Continuing without database connection.');
        logger.info('You can configure the connection later in .env');
        logger.newline();
        connectionConfig = null;
      }
    }
  }

  if (database === 'clickhouse') funnel.reach('connection_tested');
  funnel.attempt('style_selected');

  // Step 4: Get output directory
  let outputDir = options.path;
  if (!outputDir && !noInteractive) {
    outputDir = await promptOutputDirectory();
  } else if (!outputDir) {
    outputDir = 'analytics';
  }

  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

  try {
    await access(resolvedOutputDir);
    funnel.update({ analytics_directory_present: true });
  } catch {
    funnel.update({ analytics_directory_present: false });
  }

  let style = normalizeInitStyle(options.style);
  if (!options.style && !noInteractive) {
    style = await promptInitStyle();
  }
  let auth = normalizeAuthMode(options.auth);
  if (!options.auth && !noInteractive) {
    auth = normalizeAuthMode(await promptInitAuthMode());
  }

  funnel.update({ style, auth });
  funnel.reach('style_selected');
  funnel.attempt('files_written');

  // Step 5: Check for existing files
  const filesToCreate = [
    path.join(resolvedOutputDir, 'client.ts'),
    path.join(resolvedOutputDir, 'schema.ts'),
    ...(style === 'datasets'
      ? [
          path.join(resolvedOutputDir, 'datasets.ts'),
          path.join(resolvedOutputDir, 'api.ts'),
          path.join(resolvedOutputDir, 'cloud.ts'),
        ]
      : [
          path.join(resolvedOutputDir, 'queries.ts'),
        ]),
  ];

  const existingFiles: string[] = [];
  for (const file of filesToCreate) {
    try {
      await access(file);
      existingFiles.push(path.relative(process.cwd(), file));
    } catch {
      // File doesn't exist, continue
    }
  }

  if (existingFiles.length > 0 && !options.force) {
    logger.warn('Files already exist');
    logger.newline();
    const shouldOverwrite = noInteractive ? false : await confirmOverwrite(existingFiles);
    if (!shouldOverwrite) {
      logger.info('Setup cancelled');
      exitWith(0, 'cancelled');
    }
    logger.newline();
  }

  if (database === 'chdb') {
    // All prompts and overwrite checks are complete, so installing packages
    // here cannot leave a cancelled scaffold with unexpected dependencies.
    funnel.attempt('dependencies_installed');
    await installScaffoldDependencies(style, 'chdb');
    funnel.attempt('connection_tested');

    if (options.skipConnection) {
      funnel.update({ connection_result: 'skipped' });
      logger.info('Skipping embedded chDB test (requested).');
      logger.newline();
    } else {
      const chdbTest = await testChdbConnection(chdbPath);
      hasValidConnection = chdbTest.ok;
      funnel.update({ connection_result: chdbTest.ok ? 'ok' : 'failed', ...(chdbTest.ok ? { table_count_bucket: countBucket(chdbTest.tableCount) } : { chdb_failure_reason: chdbTest.reason === 'not-installed' ? 'not_installed' : 'engine_error' }) });
      if (!chdbTest.ok) {
        chdbFailureReason = chdbTest.reason;
      }

      if (!hasValidConnection) {
        if (noInteractive) {
          throw new Error(
            chdbFailureReason === 'not-installed'
              ? 'Embedded chDB failed to start in non-interactive mode. Install the chdb package and re-run.'
              : 'Embedded chDB failed to start in non-interactive mode. Resolve the engine error shown above and re-run.',
          );
        }

        const continueWithout = await promptContinueWithoutDb();
        if (!continueWithout) {
          logger.info('Setup cancelled');
          exitWith(0, 'cancelled');
        }

        logger.newline();
        logger.info('Continuing without a working embedded engine.');
        logger.newline();
      }
    }
  }

  if (database === 'chdb') funnel.reach('connection_tested');
  funnel.attempt('files_written');

  // Step 6: Ask about example query (only if we have a valid connection)
  let generateExample = !(options.noExample || (options as InitOptions & { example?: boolean }).example === false) && hasValidConnection;
  let selectedTable: string | null = null;
  let discoveredTables: string[] | null = null;

  if (generateExample && !noInteractive && hasValidConnection) {
    generateExample = await promptGenerateExample();

    if (generateExample) {
      discoveredTables = await getTables(database, { chdbPath });
      selectedTable = await promptTableSelection(discoveredTables);
      generateExample = selectedTable !== null;
    }
  }

  // Undefined when no selection was made: non-interactive runs then write a placeholder.
  let tableSelection: 'all' | 'list' | 'exclude' | 'prompt' | undefined = options.allTables ? 'all' : options.tables ? 'list' : options.excludeTables ? 'exclude' : undefined;
  let datasetTables = parseTableList(options.tables);
  const excludedDatasetTables = parseTableList(options.excludeTables);

  if (
    style === 'datasets' &&
    hasValidConnection &&
    !options.allTables &&
    !datasetTables &&
    !noInteractive
  ) {
    discoveredTables ??= await getTables(database, { chdbPath });
    tableSelection = 'prompt';
    datasetTables = await promptDatasetTableSelection(
      discoveredTables,
      selectedTable ? [selectedTable] : [],
    );
  }

  logger.newline();

  funnel.update({ example: generateExample, ...(style === 'datasets' && tableSelection ? { table_selection: tableSelection } : {}) });

  // Step 7: Create directory
  await mkdir(resolvedOutputDir, { recursive: true });

  // Step 8: Save credentials to .env (if we have connection config).
  // Embedded chDB has no credentials — the storage path lives in client.ts —
  // so the chdb scaffold writes no .env at all.
  if (database === 'chdb') {
    funnel.update({ env_file: 'skipped' });
  } else if (connectionConfig) {
    const envPath = path.join(process.cwd(), '.env');
    const envExists = await hasEnvFile();

    if (envExists) {
      const existingEnv = await readFile(envPath, 'utf-8');
      const newEnv = appendToEnv(existingEnv, generateEnvTemplate(connectionConfig));
      await writeFile(envPath, newEnv);
      funnel.update({ env_file: newEnv === existingEnv ? 'unchanged' : 'updated' });
      logger.success('Updated .env');
    } else {
      await writeFile(envPath, generateEnvTemplate(connectionConfig));
      funnel.update({ env_file: 'created' });
      logger.success('Created .env');
    }
  } else {
    // Create placeholder .env
    const envPath = path.join(process.cwd(), '.env');
    const envExists = await hasEnvFile();

    const placeholderConfig = {
      url: 'YOUR_CLICKHOUSE_URL',
      database: 'YOUR_DATABASE',
      username: 'YOUR_USERNAME',
      password: 'YOUR_PASSWORD',
    };

    funnel.update({ env_file: 'unchanged' });
    if (!envExists) {
      await writeFile(envPath, generateEnvTemplate(placeholderConfig));
      funnel.update({ env_file: 'created' });
      logger.success('Created .env (configure your credentials)');
    }
  }

  // Step 9: Generate types from schema (only if we have a valid connection)
  const schemaPath = path.join(resolvedOutputDir, 'schema.ts');

  if (hasValidConnection) {
    const typeSpinner = ora('Generating TypeScript types...').start();

    try {
      const generator = getTypeGenerator(database);
      await generator({ outputPath: schemaPath, chdbPath });
      typeSpinner.succeed(`Generated TypeScript types (${path.relative(process.cwd(), schemaPath)})`);
    } catch (error) {
      typeSpinner.fail('Failed to generate types');
      logger.error(error instanceof Error ? error.message : String(error));
      exitWith(1, 'failure', telemetryErrorCode(error));
    }
  } else {
    // Create placeholder schema file
    const regenerateHint = database === 'chdb'
      ? "// Run 'npx hypequery generate --database chdb --chdb-path <dir>' after creating persistent tables"
      : "// Run 'npx hypequery generate' after configuring your database connection";
    await writeFile(schemaPath, `// Generated by hypequery
${regenerateHint}

export interface IntrospectedSchema {
  // Your table types will appear here after generation
}
`);
    logger.success(`Created placeholder schema (${path.relative(process.cwd(), schemaPath)})`);
  }

  // Step 10: Create client.ts
  const clientPath = path.join(resolvedOutputDir, 'client.ts');
  await writeFile(clientPath, generateClientTemplate({ database, chdbPath }));
  logger.success(
    `Created ${database === 'chdb' ? 'embedded chDB' : 'ClickHouse'} client (${path.relative(process.cwd(), clientPath)})`,
  );

  // Step 11: Create API entrypoint
  let apiPath: string;
  let generatedAnyDatasets = false;
  let generatedSelectedDataset = false;
  if (style === 'datasets') {
    const datasetsPath = path.join(resolvedOutputDir, 'datasets.ts');
    const shouldGenerateDatasets = hasValidConnection && (
      options.allTables === true ||
      (datasetTables !== undefined && datasetTables.length > 0)
    );

    if (shouldGenerateDatasets) {
      const generated = await generateDatasets({
        outputPath: datasetsPath,
        includeTables: options.allTables ? undefined : datasetTables,
        excludeTables: excludedDatasetTables,
        // Context auth scaffolds a trusted runtime tenant scope on that column,
        // so datasets must declare the matching tenantKey or every tenant-scoped
        // request fails. This is explicit configuration, not a name heuristic.
        ...(auth === 'context' ? { tenantColumn: CONTEXT_AUTH_TENANT_COLUMN } : {}),
        ...(database === 'chdb'
          ? { client: getChdbTypeGenerationClient(chdbPath) }
          : {}),
      });
      if (generated) funnel.update({ datasets_generated_bucket: countBucket(generated.tables.length) });
      logDatasetGenerationWarnings(generated?.warnings);
      generatedAnyDatasets = true;
      generatedSelectedDataset = selectedTable !== null && (
        options.allTables === true ||
        datasetTables?.includes(selectedTable) === true
      );
    } else {
      await writeFile(datasetsPath, generateDatasetsPlaceholderTemplate({ auth }));
      funnel.update({ datasets_generated_bucket: '0' });
      if (hasValidConnection) {
        logger.info(
          'Skipped dataset generation. Run `'
          + formatRegenerateDatasetsCommand({ outputDir, auth, tables: 'table1,table2' })
          + '` when ready.',
        );
      }
    }
    logger.success(`Created datasets file (${path.relative(process.cwd(), datasetsPath)})`);

    apiPath = path.join(resolvedOutputDir, 'api.ts');
    await writeFile(apiPath, generateApiTemplate({ auth }));
    logger.success(`Created API file (${path.relative(process.cwd(), apiPath)})`);
    const cloudPath = path.join(resolvedOutputDir, 'cloud.ts');
    await writeFile(cloudPath, generateCloudTemplate());
    logger.success(`Created Cloud publication (${path.relative(process.cwd(), cloudPath)})`);
  } else {
    apiPath = path.join(resolvedOutputDir, 'queries.ts');
    await writeFile(
      apiPath,
      generateQueriesTemplate({
        hasExample: generateExample,
        tableName: selectedTable || undefined,
        auth,
      })
    );
    logger.success(`Created queries file (${path.relative(process.cwd(), apiPath)})`);
  }

  if (generateExample && selectedTable && (style === 'queries' || generatedSelectedDataset)) {
    logger.success(`Created example ${style === 'datasets' ? 'dataset' : 'query'} using '${selectedTable}' table`);
  }

  // Step 12: Update .gitignore
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const gitignoreExists = await hasGitignore();
  const chdbGitignoreEntry = database === 'chdb'
    ? getChdbGitignoreEntry(chdbPath, process.cwd())
    : undefined;
  const gitignoreEntries = chdbGitignoreEntry ? [chdbGitignoreEntry] : [];

  if (gitignoreExists) {
    const existingGitignore = await readFile(gitignorePath, 'utf-8');
    const newGitignore = appendToGitignore(existingGitignore, gitignoreEntries);
    funnel.update({ gitignore: 'unchanged' });
    if (newGitignore !== existingGitignore) {
      await writeFile(gitignorePath, newGitignore);
      funnel.update({ gitignore: 'updated' });
      logger.success('Updated .gitignore');
    }
  } else {
    await writeFile(gitignorePath, appendToGitignore('', gitignoreEntries));
    funnel.update({ gitignore: 'created' });
    logger.success('Created .gitignore');
  }

  funnel.reach('files_written');
  funnel.attempt('dependencies_installed');

  // Step 13: Ensure required hypequery packages are installed
  await installScaffoldDependencies(style, database);
  funnel.reach('dependencies_installed');
  funnel.attempt('completed');

  // Step 14: Success message
  logger.newline();
  logger.header('Setup complete!');

  if (hasValidConnection) {
    if (style === 'datasets' && !generatedAnyDatasets) {
      logger.info('Next:');
      logger.indent(formatRegenerateDatasetsCommand({ outputDir, auth, tables: 'table1,table2' }));
      logger.newline();
    } else if (style === 'datasets' && !generatedSelectedDataset) {
      logger.info('Next:');
      logger.indent('npx hypequery dev          Start development server');
      logger.newline();
    } else {
      logger.info('Try your first query:');
      logger.newline();
      logger.indent(`import { api } from './${path.relative(process.cwd(), apiPath).replace(/\.ts$/, '.js')}'`);
      const exampleQueryKey = generateExample && selectedTable
        ? `${selectedTable.replace(/_([a-z])/g, (_, l) => l.toUpperCase())}Query`
        : 'exampleMetric';
      if (style === 'datasets' && selectedTable) {
        logger.indent(`const result = await api.execute('dataset:${selectedTable}', { input: {} })`);
      } else {
        logger.indent(`const result = await api.execute('${exampleQueryKey}')`);
      }
      logger.newline();

      logger.info('Next:');
      logger.indent('npx hypequery dev          Start development server');
      logger.newline();
    }
  } else if (database === 'chdb') {
    logger.info('Next steps:');
    logger.newline();
    // chdb is normally installed by the scaffold itself — only tell the user
    // to install when that is actually what failed, not when an installed
    // engine could not run (unsupported platform, locked session directory).
    const firstStep = options.skipConnection
      ? '1. Verify the embedded engine and create your tables'
      : chdbFailureReason === 'engine-error'
        ? '1. Resolve the engine error shown above'
        : '1. Install the embedded engine: npm install chdb';
    logger.indent(firstStep);
    logger.indent(
      chdbPath
        ? `2. Run: npx hypequery generate --database chdb --chdb-path ${chdbPath}`
        : '2. Re-run init with --chdb-path <dir> if later generate commands must see your tables',
    );
    logger.indent('3. Run: npx hypequery dev          (to start dev server)');
    logger.newline();
  } else {
    logger.info('Next steps:');
    logger.newline();
    logger.indent('1. Configure your database connection in .env');
    logger.indent('2. Run: npx hypequery generate    (to generate types)');
    logger.indent('3. Run: npx hypequery dev          (to start dev server)');
    logger.newline();
  }

  if (database === 'chdb' && hasValidConnection) {
    logger.indent(
      chdbPath
        ? `hypequery generate --database chdb --chdb-path ${chdbPath}   Refresh types after creating tables`
        : 'In-memory chDB is process-local; use --chdb-path <dir> for later type generation',
    );
    logger.newline();
  }

  funnel.reach('completed');
  logger.info('Docs: https://hypequery.com/docs');
  logger.newline();
}
