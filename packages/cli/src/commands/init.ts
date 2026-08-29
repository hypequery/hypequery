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
  type DatabaseType,
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
import { generateDatasetsPlaceholderTemplate } from '../templates/datasets.js';
import { appendToGitignore } from '../templates/gitignore.js';
import { getTypeGenerator } from '../generators/index.js';
import { generateDatasets } from '../generators/dataset-generator.js';
import { installScaffoldDependencies } from '../utils/dependency-installer.js';
import { logDatasetGenerationWarnings } from '../utils/dataset-generation-warnings.js';

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

type InitDatabase = Extract<DatabaseType, 'clickhouse' | 'chdb'>;

function normalizeInitDatabase(database: InitOptions['database']): InitDatabase {
  if (!database || database === 'clickhouse') {
    return 'clickhouse';
  }
  if (database === 'chdb') {
    return 'chdb';
  }
  throw new Error(`Unsupported database "${database}". Use "clickhouse" or "chdb".`);
}

function normalizeInitStyle(style: InitOptions['style']): InitStyle {
  return style === 'datasets' ? 'datasets' : 'queries';
}

function normalizeAuthMode(auth: InitOptions['auth']): AuthTemplateMode {
  if (!auth || auth === 'none') {
    return 'none';
  }
  if (auth === 'context') {
    return 'context';
  }
  throw new Error(`Unsupported auth mode "${auth}". Use "none" or "context".`);
}

function parseTableList(value: string | undefined): string[] | undefined {
  const parsed = value
    ?.split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

function getChdbGitignoreEntry(chdbPath: string | undefined): string | undefined {
  if (!chdbPath || /[\0\r\n]/.test(chdbPath)) {
    return undefined;
  }

  const cwd = path.resolve(process.cwd());
  const relativePath = path.relative(cwd, path.resolve(cwd, chdbPath));
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  const normalizedPath = relativePath.split(path.sep).join('/');
  const escapedPath = normalizedPath.replace(/[\\*?[\]]/g, '\\$&');
  return `/${escapedPath}/`;
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

type ChdbTestResult = { ok: true } | { ok: false; reason: 'not-installed' | 'engine-error' };

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
  return { ok: true };
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
  const noInteractive = options.noInteractive === true || (options as InitOptions & { interactive?: boolean }).interactive === false;

  logger.newline();
  logger.header('Welcome to hypequery!');

  if (!noInteractive && !(await hasProjectPackageJson())) {
    logger.warn(`package.json not found in ${process.cwd()}`);
    const shouldContinue = await confirmWithoutPackageJson(process.cwd());
    if (!shouldContinue) {
      logger.info('Setup cancelled. Run init from your project directory.');
      return;
    }
    logger.newline();
  }

  const database = normalizeInitDatabase(
    options.database ?? (noInteractive ? undefined : await promptInitDatabase()),
  );
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
      logger.info('Skipping database connection for now.');
      logger.newline();
    } else if (options.skipConnection) {
      logger.info('Skipping database connection test (requested).');
      logger.newline();
    } else {
      const { hasValidConnection: valid } = await testConnection(connectionConfig);
      hasValidConnection = valid;

      if (!hasValidConnection) {
        if (noInteractive) {
          throw new Error('Failed to connect to ClickHouse in non-interactive mode. Check your environment variables or use interactive setup.');
        }

        const retry = await promptRetry('Try again?');
        if (retry) {
          return initCommand({ ...options, database });
        }

        const continueWithout = await promptContinueWithoutDb();
        if (!continueWithout) {
          logger.info('Setup cancelled');
          process.exit(0);
        }

        logger.newline();
        logger.info('Continuing without database connection.');
        logger.info('You can configure the connection later in .env');
        logger.newline();
        connectionConfig = null;
      }
    }
  }

  // Step 4: Get output directory
  let outputDir = options.path;
  if (!outputDir && !noInteractive) {
    outputDir = await promptOutputDirectory();
  } else if (!outputDir) {
    outputDir = 'analytics';
  }

  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

  let style = normalizeInitStyle(options.style);
  if (!options.style && !noInteractive) {
    style = await promptInitStyle();
  }
  let auth = normalizeAuthMode(options.auth);
  if (!options.auth && !noInteractive) {
    auth = normalizeAuthMode(await promptInitAuthMode());
  }

  // Step 5: Check for existing files
  const filesToCreate = [
    path.join(resolvedOutputDir, 'client.ts'),
    path.join(resolvedOutputDir, 'schema.ts'),
    ...(style === 'datasets'
      ? [
          path.join(resolvedOutputDir, 'datasets.ts'),
          path.join(resolvedOutputDir, 'api.ts'),
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
      process.exit(0);
    }
    logger.newline();
  }

  if (database === 'chdb') {
    // All prompts and overwrite checks are complete, so installing packages
    // here cannot leave a cancelled scaffold with unexpected dependencies.
    await installScaffoldDependencies(style, 'chdb');

    if (options.skipConnection) {
      logger.info('Skipping embedded chDB test (requested).');
      logger.newline();
    } else {
      const chdbTest = await testChdbConnection(chdbPath);
      hasValidConnection = chdbTest.ok;
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
          process.exit(0);
        }

        logger.newline();
        logger.info('Continuing without a working embedded engine.');
        logger.newline();
      }
    }
  }

  // Step 6: Ask about example query (only if we have a valid connection)
  let generateExample = !options.noExample && hasValidConnection;
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
    datasetTables = await promptDatasetTableSelection(
      discoveredTables,
      selectedTable ? [selectedTable] : [],
    );
  }

  logger.newline();

  // Step 7: Create directory
  await mkdir(resolvedOutputDir, { recursive: true });

  // Step 8: Save credentials to .env (if we have connection config).
  // Embedded chDB has no credentials — the storage path lives in client.ts —
  // so the chdb scaffold writes no .env at all.
  if (database === 'chdb') {
    // nothing to persist
  } else if (connectionConfig) {
    const envPath = path.join(process.cwd(), '.env');
    const envExists = await hasEnvFile();

    if (envExists) {
      const existingEnv = await readFile(envPath, 'utf-8');
      const newEnv = appendToEnv(existingEnv, generateEnvTemplate(connectionConfig));
      await writeFile(envPath, newEnv);
      logger.success('Updated .env');
    } else {
      await writeFile(envPath, generateEnvTemplate(connectionConfig));
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

    if (!envExists) {
      await writeFile(envPath, generateEnvTemplate(placeholderConfig));
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
      process.exit(1);
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
        ...(database === 'chdb'
          ? { client: getChdbTypeGenerationClient(chdbPath) }
          : {}),
      });
      logDatasetGenerationWarnings(generated?.warnings);
      generatedAnyDatasets = true;
      generatedSelectedDataset = selectedTable !== null && (
        options.allTables === true ||
        datasetTables?.includes(selectedTable) === true
      );
    } else {
      await writeFile(datasetsPath, generateDatasetsPlaceholderTemplate());
      if (hasValidConnection) {
        logger.info('Skipped dataset generation. Run `hypequery generate:datasets --path ' + outputDir + ' --tables table1,table2` when ready.');
      }
    }
    logger.success(`Created datasets file (${path.relative(process.cwd(), datasetsPath)})`);

    apiPath = path.join(resolvedOutputDir, 'api.ts');
    await writeFile(apiPath, generateApiTemplate({ auth }));
    logger.success(`Created API file (${path.relative(process.cwd(), apiPath)})`);
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
    ? getChdbGitignoreEntry(chdbPath)
    : undefined;
  const gitignoreEntries = chdbGitignoreEntry ? [chdbGitignoreEntry] : [];

  if (gitignoreExists) {
    const existingGitignore = await readFile(gitignorePath, 'utf-8');
    const newGitignore = appendToGitignore(existingGitignore, gitignoreEntries);
    if (newGitignore !== existingGitignore) {
      await writeFile(gitignorePath, newGitignore);
      logger.success('Updated .gitignore');
    }
  } else {
    await writeFile(gitignorePath, appendToGitignore('', gitignoreEntries));
    logger.success('Created .gitignore');
  }

  // Step 13: Ensure required hypequery packages are installed
  await installScaffoldDependencies(style, database);

  // Step 14: Success message
  logger.newline();
  logger.header('Setup complete!');

  if (hasValidConnection) {
    if (style === 'datasets' && !generatedAnyDatasets) {
      logger.info('Next:');
      logger.indent(`hypequery generate:datasets --path ${outputDir} --tables table1,table2`);
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

  logger.info('Docs: https://hypequery.com/docs');
  logger.newline();
}
