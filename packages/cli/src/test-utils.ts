import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  column,
  defineSchema,
  defineTable,
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  type ClickHouseSchemaAst,
} from '@hypequery/schema';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * Mock prompts module for testing
 */
export function createMockPrompts() {
  return {
    promptClickHouseConnection: vi.fn(),
    promptOutputDirectory: vi.fn(),
    promptGenerateExample: vi.fn(),
    promptTableSelection: vi.fn(),
    confirmOverwrite: vi.fn(),
    promptRetry: vi.fn(),
    promptContinueWithoutDb: vi.fn(),
  };
}

/**
 * Mock database detection utilities
 */
export function createMockDatabaseUtils() {
  return {
    validateConnection: vi.fn(),
    getTableCount: vi.fn(),
    getTables: vi.fn(),
  };
}

/**
 * Mock file system utilities
 */
export function createMockFileUtils() {
  return {
    hasEnvFile: vi.fn(),
    hasGitignore: vi.fn(),
    findQueriesFile: vi.fn(),
    findSchemaFile: vi.fn(),
  };
}

/**
 * Mock logger to capture output
 */
export function createMockLogger() {
  return {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    reload: vi.fn(),
    header: vi.fn(),
    newline: vi.fn(),
    indent: vi.fn(),
    box: vi.fn(),
    table: vi.fn(),
    raw: vi.fn(),
  };
}

/**
 * Mock ora spinner
 */
export function createMockSpinner() {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  };
  return vi.fn(() => spinner);
}

/**
 * Mock fs/promises for file operations
 */
export function createMockFs() {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    access: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Capture console output
 */
export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  console.log = vi.fn((...args) => {
    logs.push(args.join(' '));
  });

  console.error = vi.fn((...args) => {
    errors.push(args.join(' '));
  });

  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

/**
 * Mock process.exit to prevent tests from exiting
 * Throws a special error to stop execution
 */
export class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit called with code ${code}`);
    this.name = 'ProcessExitError';
  }
}

export function mockProcessExit() {
  const originalExit = process.exit;
  const exitMock = vi.fn((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as Mock;

  process.exit = exitMock as unknown as typeof process.exit;

  return {
    exitMock,
    restore: () => {
      process.exit = originalExit;
    },
  };
}

export async function createMigrationFilesFixture(rootDir: string, name: string) {
  const migrationDir = path.join(rootDir, 'migrations', name);
  await mkdir(migrationDir, { recursive: true });
  await writeFile(path.join(migrationDir, 'up.sql'), 'SELECT 1;\n', 'utf8');
  await writeFile(path.join(migrationDir, 'down.sql'), 'SELECT 0;\n', 'utf8');
  await writeFile(path.join(migrationDir, 'meta.json'), '{}\n', 'utf8');
  await writeFile(path.join(migrationDir, 'plan.json'), '{}\n', 'utf8');
  return migrationDir;
}

export function migrationConfigFixture() {
  return {
    dialect: 'clickhouse',
    schema: './schema.ts',
    migrations: { out: './migrations' },
    dbCredentials: {
      host: 'localhost',
      username: 'default',
      database: 'analytics',
    },
  };
}

export function mockConfigAndSchemaLoader(
  loadModule: Mock,
  schema: ClickHouseSchemaAst,
  config = migrationConfigFixture(),
) {
  loadModule.mockImplementation(async (modulePath) => {
    if (modulePath === 'hypequery.config.ts') {
      return { default: config };
    }

    return { default: schema };
  });
}

export async function writeLatestSnapshotFixture(rootDir: string, schema: ClickHouseSchemaAst) {
  const snapshot = serializeSchemaToSnapshot(schema);
  const metaDir = path.join(rootDir, 'migrations', 'meta');
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, 'latest_snapshot.json'),
    `${snapshotToStableJson(snapshot)}\n`,
    'utf8',
  );
}

export function emptyMigrationSchema() {
  return defineSchema({ tables: [] });
}

export function eventsMigrationSchema() {
  return defineSchema({
    tables: [
      defineTable('events', {
        columns: {
          id: column.UUID(),
          created_at: column.DateTime(),
        },
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
        },
      }),
    ],
  });
}

export function eventsMigrationSchemaWithNameColumn() {
  return defineSchema({
    tables: [
      defineTable('events', {
        columns: {
          id: column.UUID(),
          created_at: column.DateTime(),
          name: column.String(),
        },
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
        },
      }),
    ],
  });
}
