import prompts from 'prompts';
import type { DatabaseType } from './detect-database.js';
import { logger } from './logger.js';

// Configure prompts to not exit on cancel
prompts.override({ onCancel: () => {} });

/**
 * Prompt for database type selection
 */
export async function promptDatabaseType(): Promise<DatabaseType | null> {
  const response = await prompts({
    type: 'select',
    name: 'database',
    message: 'Which database are you using?',
    choices: [
      { title: 'ClickHouse', value: 'clickhouse' },
      { title: 'BigQuery (coming soon)', value: 'bigquery', disabled: true },
    ],
    initial: 0,
  });

  return response.database || null;
}

/**
 * Prompt for connection mode: connect to ClickHouse or start with an example
 */
export async function promptConnectionMode(): Promise<'connect' | 'example'> {
  const response = await prompts({
    type: 'select',
    name: 'mode',
    message: 'How would you like to get started?',
    choices: [
      { title: 'Connect to ClickHouse', description: 'Generate types from your existing database', value: 'connect' },
      { title: 'Start with example project', description: 'Explore the API with sample data — no database needed', value: 'example' },
    ],
    initial: 0,
  });

  return response.mode ?? 'example';
}

/**
 * Prompt for ClickHouse connection details
 */
export async function promptClickHouseConnection(): Promise<{
  host: string;
  database: string;
  username: string;
  password: string;
} | null> {
  let cancelled = false;

  const response = await prompts([
    {
      type: 'text',
      name: 'host',
      message: 'ClickHouse host (or skip to configure later):',
      initial: process.env.CLICKHOUSE_HOST ?? '',
    },
    {
      type: 'text',
      name: 'database',
      message: 'Database:',
      initial: process.env.CLICKHOUSE_DATABASE ?? '',
    },
    {
      type: 'text',
      name: 'username',
      message: 'Username:',
      initial: process.env.CLICKHOUSE_USERNAME ?? '',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password:',
      initial: process.env.CLICKHOUSE_PASSWORD ?? '',
    },
  ], {
    onCancel: () => {
      cancelled = true;
      return false; // stop the prompt chain
    },
  });

  // If user cancelled, skipped, or abandoned mid-way through the prompts
  if (cancelled || !response.host || !response.database || !response.username) {
    return null;
  }

  return {
    host: response.host,
    database: response.database,
    username: response.username,
    password: response.password ?? '',
  };
}

/**
 * Prompt for output directory
 */
export async function promptOutputDirectory(): Promise<string> {
  const response = await prompts({
    type: 'select',
    name: 'directory',
    message: 'Where should we create your analytics files?',
    choices: [
      { title: 'analytics/ (recommended)', value: 'analytics' },
      { title: 'src/analytics/', value: 'src/analytics' },
      { title: 'Custom path...', value: 'custom' },
    ],
    initial: 0,
  });

  if (!response.directory) {
    return 'analytics'; // Default fallback
  }

  if (response.directory === 'custom') {
    const customResponse = await prompts({
      type: 'text',
      name: 'path',
      message: 'Enter custom path:',
      initial: 'analytics',
    });

    return customResponse.path || 'analytics';
  }

  return response.directory;
}

/**
 * Prompt for example query generation
 */
export async function promptGenerateExample(): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'generate',
    message: 'Generate an example query?',
    initial: true,
  });

  return response.generate ?? false;
}

/**
 * Prompt for table selection (for example query)
 */
export async function promptTableSelection(tables: string[]): Promise<string | null> {
  if (tables.length === 0) {
    return null;
  }

  // Warn if showing truncated list
  if (tables.length > 10) {
    logger.warn(`Showing first 10 of ${tables.length} tables`);
    logger.indent('You can select a different table by editing the generated file');
    logger.newline();
  }

  const choices = [
    ...tables.slice(0, 10).map(table => ({ title: table, value: table })),
    { title: 'Skip example', value: null },
  ];

  const response = await prompts({
    type: 'select',
    name: 'table',
    message: 'Which table should we use for the example?',
    choices,
    initial: 0,
  });

  return response.table;
}

/**
 * Confirm overwrite of existing files
 */
export async function confirmOverwrite(files: string[]): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'overwrite',
    message: `The following files will be overwritten:\n${files.map(f => `  • ${f}`).join('\n')}\n\nContinue?`,
    initial: false,
  });

  return response.overwrite ?? false;
}

/**
 * Retry prompt for failed operations
 */
export async function promptRetry(message: string): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'retry',
    message,
    initial: true,
  });

  return response.retry ?? false;
}

/**
 * Ask if user wants to continue with an example project instead
 */
export async function promptContinueWithoutDb(): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'continue',
    message: 'Continue with an example project instead? (no database required)',
    initial: true,
  });

  return response.continue ?? false;
}
