import type { InitOptions } from '../commands/init.js';
import type { InitStyle } from './prompts.js';
import type { AuthTemplateMode } from '../templates/queries.js';
import type { DatabaseType } from './detect-database.js';

type InitDatabase = Extract<DatabaseType, 'clickhouse' | 'chdb'>;

export function normalizeInitDatabase(database: InitOptions['database']): InitDatabase {
  if (!database || database === 'clickhouse') {
    return 'clickhouse';
  }
  if (database === 'chdb') {
    return 'chdb';
  }
  throw new Error(`Unsupported database "${database}". Use "clickhouse" or "chdb".`);
}

export function normalizeInitStyle(style: InitOptions['style']): InitStyle {
  return style === 'datasets' ? 'datasets' : 'queries';
}

export function normalizeAuthMode(auth: InitOptions['auth']): AuthTemplateMode {
  if (!auth || auth === 'none') {
    return 'none';
  }
  if (auth === 'context') {
    return 'context';
  }
  throw new Error(`Unsupported auth mode "${auth}". Use "none" or "context".`);
}

export function parseTableList(value: string | undefined): string[] | undefined {
  const parsed = value
    ?.split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : undefined;
}
