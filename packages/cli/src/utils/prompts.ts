import prompts from 'prompts';
import { logger } from './logger.js';

const noop = () => undefined;

// Configure prompts to not exit on cancel
prompts.override({ onCancel: noop });

/**
 * Prompt for ClickHouse connection details
 */
export async function promptClickHouseConnection(): Promise<{
  host: string;
  database: string;
  username: string;
  password: string;
} | null> {
  const hostResponse = await prompts({
    type: 'text',
    name: 'host',
    message: 'ClickHouse URL (or skip to configure later):',
    initial: process.env.CLICKHOUSE_URL ?? process.env.CLICKHOUSE_HOST ?? '',
  });

  // Do not ask for credentials when the user has chosen to configure the
  // connection later.
  if (!hostResponse.host) {
    return null;
  }

  const credentials = await prompts([
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
  ]);

  return {
    host: hostResponse.host,
    database: credentials.database ?? '',
    username: credentials.username ?? '',
    password: credentials.password ?? '',
  };
}

export type InitDatabase = 'clickhouse' | 'chdb';

/**
 * Choose between a remote ClickHouse server and embedded chDB.
 */
export async function promptInitDatabase(): Promise<InitDatabase> {
  const response = await prompts({
    type: 'select',
    name: 'database',
    message: 'Choose your database',
    choices: [
      { title: 'ClickHouse server or Cloud', value: 'clickhouse' },
      { title: 'chDB (embedded, no server)', value: 'chdb' },
    ],
    initial: 0,
  });

  return response.database ?? 'clickhouse';
}

/**
 * Prompt for embedded chDB storage: ephemeral in-memory session, or an
 * on-disk directory that persists between runs. Returns the session path,
 * or undefined for in-memory.
 */
export async function promptChdbStorage(): Promise<string | undefined> {
  const response = await prompts({
    type: 'select',
    name: 'storage',
    message: 'Where should embedded chDB store data?',
    choices: [
      { title: 'In-memory (discarded on exit)', value: 'memory' },
      { title: 'Local directory (./analytics.chdb)', value: 'file' },
      { title: 'Custom path...', value: 'custom' },
    ],
    initial: 0,
  });

  if (!response.storage || response.storage === 'memory') {
    return undefined;
  }

  if (response.storage === 'custom') {
    const customResponse = await prompts({
      type: 'text',
      name: 'path',
      message: 'Enter chDB data directory:',
      initial: './analytics.chdb',
    });
    return customResponse.path || './analytics.chdb';
  }

  return './analytics.chdb';
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

export type InitStyle = 'queries' | 'datasets';

export async function promptInitStyle(): Promise<InitStyle> {
  const response = await prompts({
    type: 'select',
    name: 'style',
    message: 'Choose your dev API style',
    choices: [
      { title: 'Query builder routes', value: 'queries' },
      { title: 'Datasets semantic API', value: 'datasets' },
    ],
    initial: 0,
  });

  return response.style ?? 'queries';
}

export type InitAuthMode = 'none' | 'context';

/**
 * Choose whether generated routes include request-context auth scaffolding.
 */
export async function promptInitAuthMode(): Promise<InitAuthMode> {
  const response = await prompts({
    type: 'select',
    name: 'auth',
    message: 'Choose authentication scaffolding',
    choices: [
      { title: 'None (add later)', value: 'none' },
      { title: 'Request context authentication', value: 'context' },
    ],
    initial: 0,
  });

  return response.auth ?? 'none';
}

/**
 * Confirm scaffolding when init is run outside a Node project.
 */
export async function confirmWithoutPackageJson(directory: string): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'continue',
    message: `package.json was not found in ${directory}. Continue scaffolding here?`,
    initial: false,
  });

  return response.continue ?? false;
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
 * Prompt for dataset table selection.
 */
export async function promptDatasetTableSelection(
  tables: string[],
  defaultTables: string[] = [],
): Promise<string[]> {
  if (tables.length === 0) {
    return [];
  }

  // Warn if showing truncated list
  if (tables.length > 20) {
    logger.warn(`Showing first 20 of ${tables.length} tables`);
    logger.indent('Use --tables or --all-tables for more control in larger databases');
    logger.newline();
  }

  const defaults = new Set(defaultTables);
  const response = await prompts({
    type: 'multiselect',
    name: 'tables',
    message: 'Which tables should we scaffold as datasets?',
    choices: tables.slice(0, 20).map(table => ({
      title: table,
      value: table,
      selected: defaults.has(table),
    })),
    min: 0,
    instructions: false,
  });

  return response.tables ?? [];
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
 * Ask if user wants to continue without DB connection
 */
export async function promptContinueWithoutDb(): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'continue',
    message: 'Continue setup without database connection?',
    initial: true,
  });

  return response.continue ?? false;
}
