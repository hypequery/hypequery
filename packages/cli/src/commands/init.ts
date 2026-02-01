import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import type { DatabaseType } from '../utils/detect-database.js';
import { logger } from '../utils/logger.js';
import {
  promptDatabaseType,
  promptConnectionMode,
  promptClickHouseConnection,
  promptOutputDirectory,
  promptGenerateExample,
  promptTableSelection,
  confirmOverwrite,
  promptRetry,
  promptContinueWithoutDb,
} from '../utils/prompts.js';
import {
  validateConnection,
  getTableCount,
  getTables,
} from '../utils/detect-database.js';
import { hasEnvFile, hasGitignore } from '../utils/find-files.js';
import { generateEnvTemplate, appendToEnv } from '../templates/env.js';
import { generateClientTemplate } from '../templates/client.js';
import { generateQueriesTemplate } from '../templates/queries.js';
import { appendToGitignore } from '../templates/gitignore.js';
import { getTypeGenerator } from '../generators/index.js';
import { generateExampleSchemaTemplate } from '../templates/example-schema.js';
import { installServeDependencies } from '../utils/dependency-installer.js';

export interface InitOptions {
  database?: string;
  path?: string;
  noExample?: boolean;
  noInteractive?: boolean;
  force?: boolean;
  skipConnection?: boolean;
}

type ConnectionConfig = {
  host: string;
  database: string;
  username: string;
  password: string;
};

async function determineDatabase(options: InitOptions): Promise<DatabaseType> {
  const dbType = (options.database as DatabaseType | undefined) ?? (await promptDatabaseType());

  if (!dbType) {
    logger.info('Setup cancelled');
    process.exit(0);
  }

  if (dbType !== 'clickhouse') {
    logger.error(`${dbType} is not yet supported. Only ClickHouse is available.`);
    process.exit(1);
  }

  return dbType;
}

async function resolveConnectionConfig(options: InitOptions): Promise<ConnectionConfig | null> {
  if (options.noInteractive) {
    const required = (key: string): string => {
      const value = process.env[key];
      if (!value) {
        throw new Error(
          `Missing ${key}. Provide ClickHouse connection info via environment variables when using --no-interactive.`,
        );
      }
      return value;
    };

    return {
      host: required('CLICKHOUSE_HOST'),
      database: required('CLICKHOUSE_DATABASE'),
      username: required('CLICKHOUSE_USERNAME'),
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
    };
  }

  return promptClickHouseConnection();
}

async function testConnection(
  connectionConfig: ConnectionConfig,
  dbType: DatabaseType,
): Promise<{ hasValidConnection: boolean; tableCount: number }> {
  const spinner = ora('Testing connection...').start();
  process.env.CLICKHOUSE_HOST = connectionConfig.host;
  process.env.CLICKHOUSE_DATABASE = connectionConfig.database;
  process.env.CLICKHOUSE_USERNAME = connectionConfig.username;
  process.env.CLICKHOUSE_PASSWORD = connectionConfig.password;

  const isValid = await validateConnection(dbType);

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

  const tableCount = await getTableCount(dbType);
  spinner.succeed(`Connected successfully (${tableCount} tables found)`);
  logger.newline();
  return { hasValidConnection: true, tableCount };
}

export async function initCommand(options: InitOptions = {}) {
  logger.newline();
  logger.header('Welcome to hypequery!');
  logger.info("Let's set up your analytics layer.");
  logger.newline();

  const dbType = await determineDatabase(options);

  // Step 2: Ask how the user wants to get started
  let connectionMode: 'connect' | 'example' = 'connect';
  let connectionConfig: ConnectionConfig | null = null;
  let hasValidConnection = false;
  let tableCount = 0;
  let isExampleMode = false;

  if (!options.noInteractive && !options.skipConnection) {
    connectionMode = await promptConnectionMode();
  }

  if (connectionMode === 'example') {
    isExampleMode = true;
    logger.newline();
    logger.info('Great — we\'ll set up an example project you can explore right away.');
    logger.newline();
  } else {
    // Get connection details
    connectionConfig = await resolveConnectionConfig(options);

    // Handle user skipping connection details
    if (!connectionConfig) {
      isExampleMode = true;
      logger.info('No connection details provided — generating example project instead.');
      logger.newline();
    } else if (options.skipConnection) {
      logger.info('Skipping database connection test (requested).');
      logger.newline();
    } else {
      const { hasValidConnection: valid, tableCount: count } = await testConnection(connectionConfig, dbType);
      hasValidConnection = valid;
      tableCount = count;

      if (!hasValidConnection) {
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
        logger.info('Continuing with example project instead.');
        logger.newline();
        connectionConfig = null;
        isExampleMode = true;
      }
    }
  }

  // Step 4: Get output directory
  let outputDir = options.path;
  if (!outputDir && !options.noInteractive) {
    outputDir = await promptOutputDirectory();
  } else if (!outputDir) {
    outputDir = 'analytics';
  }

  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);

  // Step 5: Check for existing files
  const filesToCreate = [
    path.join(resolvedOutputDir, 'client.ts'),
    path.join(resolvedOutputDir, 'schema.ts'),
    path.join(resolvedOutputDir, 'queries.ts'),
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
    const shouldOverwrite = await confirmOverwrite(existingFiles);
    if (!shouldOverwrite) {
      logger.info('Setup cancelled');
      process.exit(0);
    }
    logger.newline();
  }

  // Step 6: Ask about example query (only if we have a valid connection, not in example mode)
  let generateExample = !options.noExample && hasValidConnection && !isExampleMode;
  let selectedTable: string | null = null;

  if (generateExample && !options.noInteractive && hasValidConnection) {
    generateExample = await promptGenerateExample();

    if (generateExample) {
      const tables = await getTables(dbType);
      selectedTable = await promptTableSelection(tables);
      generateExample = selectedTable !== null;
    }
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
      host: 'YOUR_CLICKHOUSE_HOST',
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
  } else if (isExampleMode) {
    // Create example schema with realistic sample tables
    await writeFile(schemaPath, generateExampleSchemaTemplate());
    logger.success(`Created example schema (${path.relative(process.cwd(), schemaPath)})`);
  } else {
    // Create placeholder schema file (skipConnection with real credentials)
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

  // Step 11: Create queries.ts
  const queriesPath = path.join(resolvedOutputDir, 'queries.ts');
  await writeFile(
    queriesPath,
    generateQueriesTemplate({
      hasExample: generateExample,
      tableName: selectedTable || undefined,
      exampleMode: isExampleMode,
    })
  );
  logger.success(`Created queries file (${path.relative(process.cwd(), queriesPath)})`);

  if (isExampleMode) {
    logger.success('Created example queries (recentUsers, ordersByStatus, topPages)');
  } else if (generateExample && selectedTable) {
    logger.success(`Created example query using '${selectedTable}' table`);
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
  await installServeDependencies();

  // Step 14: Success message
  logger.newline();
  logger.header('Setup complete!');

  if (hasValidConnection) {
    logger.info('Try your first query:');
    logger.newline();
    logger.indent(`import { api } from './${path.relative(process.cwd(), queriesPath).replace(/\.ts$/, '.js')}'`);
    const exampleQueryKey = generateExample && selectedTable
      ? `${selectedTable.replace(/_([a-z])/g, (_, l) => l.toUpperCase())}Query`
      : 'exampleMetric';
    logger.indent(`const result = await api.execute('${exampleQueryKey}')`);
    logger.newline();

    logger.info('Next:');
    logger.indent('npx hypequery dev          Start development server');
    logger.newline();
  } else if (isExampleMode) {
    logger.info('Your example project is ready to explore!');
    logger.newline();
    logger.info('Generated files:');
    logger.indent(`${outputDir}/schema.ts    Sample tables (users, orders, page_events)`);
    logger.indent(`${outputDir}/queries.ts   Example queries using the hypequery API`);
    logger.indent(`${outputDir}/client.ts    ClickHouse client setup`);
    logger.newline();
    logger.info('When you\'re ready to connect to a real database:');
    logger.indent('1. Update your credentials in .env');
    logger.indent('2. Run: npx hypequery generate    (to generate types from your schema)');
    logger.indent('3. Run: npx hypequery dev          (to start the dev server)');
    logger.newline();
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
