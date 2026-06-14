import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import {
  promptClickHouseConnection,
  promptOutputDirectory,
  promptInitStyle,
  promptGenerateExample,
  promptTableSelection,
  promptDatasetTableSelection,
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

export interface InitOptions {
  path?: string;
  style?: InitStyle;
  allTables?: boolean;
  tables?: string;
  excludeTables?: string;
  noExample?: boolean;
  noInteractive?: boolean;
  force?: boolean;
  skipConnection?: boolean;
  auth?: AuthTemplateMode;
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
  logger.info("Let's set up your analytics layer.");
  logger.newline();

  // Step 2: Get connection details
  let connectionConfig = await resolveConnectionConfig(options);
  let hasValidConnection = false;

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
        return initCommand(options);
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

  // Step 4: Get output directory
  let outputDir = options.path;
  if (!outputDir && !noInteractive) {
    outputDir = await promptOutputDirectory();
  } else if (!outputDir) {
    outputDir = 'analytics';
  }

  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

  let style = normalizeInitStyle(options.style);
  const auth = normalizeAuthMode(options.auth);
  if (!options.style && !noInteractive) {
    style = await promptInitStyle();
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

  // Step 6: Ask about example query (only if we have a valid connection)
  let generateExample = !options.noExample && hasValidConnection;
  let selectedTable: string | null = null;
  let discoveredTables: string[] | null = null;

  if (generateExample && !noInteractive && hasValidConnection) {
    generateExample = await promptGenerateExample();

    if (generateExample) {
      discoveredTables = await getTables('clickhouse');
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
    discoveredTables ??= await getTables('clickhouse');
    datasetTables = await promptDatasetTableSelection(
      discoveredTables,
      selectedTable ? [selectedTable] : [],
    );
  }

  logger.newline();

  // Step 7: Create directory
  await mkdir(resolvedOutputDir, { recursive: true });

  // Step 8: Save credentials to .env (if we have connection config)
  if (connectionConfig) {
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
      const generator = getTypeGenerator('clickhouse');
      await generator({ outputPath: schemaPath });
      typeSpinner.succeed(`Generated TypeScript types (${path.relative(process.cwd(), schemaPath)})`);
    } catch (error) {
      typeSpinner.fail('Failed to generate types');
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else {
    // Create placeholder schema file
    await writeFile(schemaPath, `// Generated by hypequery
// Run 'npx hypequery generate' after configuring your database connection

export interface IntrospectedSchema {
  // Your table types will appear here after generation
}
`);
    logger.success(`Created placeholder schema (${path.relative(process.cwd(), schemaPath)})`);
  }

  // Step 10: Create client.ts
  const clientPath = path.join(resolvedOutputDir, 'client.ts');
  await writeFile(clientPath, generateClientTemplate());
  logger.success(`Created ClickHouse client (${path.relative(process.cwd(), clientPath)})`);

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
      await generateDatasets({
        outputPath: datasetsPath,
        includeTables: options.allTables ? undefined : datasetTables,
        excludeTables: excludedDatasetTables,
      });
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

  if (gitignoreExists) {
    const existingGitignore = await readFile(gitignorePath, 'utf-8');
    const newGitignore = appendToGitignore(existingGitignore);
    if (newGitignore !== existingGitignore) {
      await writeFile(gitignorePath, newGitignore);
      logger.success('Updated .gitignore');
    }
  } else {
    await writeFile(gitignorePath, appendToGitignore(''));
    logger.success('Created .gitignore');
  }

  // Step 13: Ensure required hypequery packages are installed
  await installScaffoldDependencies(style);

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
  } else {
    logger.info('Next steps:');
    logger.newline();
    logger.indent('1. Configure your database connection in .env');
    logger.indent('2. Run: npx hypequery generate    (to generate types)');
    logger.indent('3. Run: npx hypequery dev          (to start dev server)');
    logger.newline();
  }

  logger.info('Docs: https://hypequery.com/docs');
  logger.newline();
}
