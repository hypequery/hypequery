import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessExitError, mockProcessExit } from '../test-utils.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/load-hypequery-config.js', () => ({
  DEFAULT_HYPEQUERY_CONFIG_PATH: 'hypequery.config.ts',
  loadHypequeryConfig: vi.fn(),
}));

vi.mock('../utils/load-api.js', () => ({
  loadModule: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
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
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start() { return this; },
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock('@hypequery/clickhouse', () => ({
  serializeSchemaToSnapshot: vi.fn(),
  diffSnapshots: vi.fn(),
  renderMigrationArtifacts: vi.fn(),
  writeMigrationArtifacts: vi.fn(),
  snapshotToStableJson: vi.fn(() => '{"ok":true}'),
  hashSnapshot: vi.fn(() => 'empty-hash'),
}));

describe('generate migration command', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('writes migration artifacts and snapshot for a valid plan', async () => {
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const { loadModule } = await import('../utils/load-api.js');
    const fs = await import('node:fs/promises');
    const clickhouse = await import('@hypequery/clickhouse');
    const { generateMigrationCommand } = await import('./generate-migration.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', username: 'default', database: 'analytics' },
    });
    vi.mocked(loadModule).mockResolvedValue({
      default: { tables: [], materializedViews: [] },
    });

    const snapshot = {
      version: 1 as const,
      dialect: 'clickhouse' as const,
      tables: [{ name: 'users', columns: [], engine: { type: 'MergeTree', orderBy: [], primaryKey: [] }, settings: {} }],
      materializedViews: [],
      dependencies: [],
      contentHash: 'next-hash',
    };
    vi.mocked(clickhouse.serializeSchemaToSnapshot).mockReturnValue(snapshot);
    vi.mocked(clickhouse.diffSnapshots).mockReturnValue({
      previousSnapshot: {
        version: 1,
        dialect: 'clickhouse',
        tables: [],
        materializedViews: [],
        dependencies: [],
        contentHash: 'prev-hash',
      },
      nextSnapshot: snapshot,
      operations: [{ kind: 'CreateTable', table: snapshot.tables[0] }],
      warnings: [],
      unsupportedChanges: [],
    } as any);
    vi.mocked(clickhouse.renderMigrationArtifacts).mockReturnValue({
      upSql: 'CREATE TABLE users;',
      downSql: 'DROP TABLE users;',
      meta: {
        name: 'add_users',
        timestamp: '20260424210000',
        operations: [{ kind: 'CreateTable', classification: 'metadata' }],
        sourceSnapshotHash: 'prev-hash',
        targetSnapshotHash: 'next-hash',
        custom: false,
        unsafe: false,
        containsManualSteps: false,
      },
      plan: {
        operations: [{ operation: { kind: 'CreateTable', table: snapshot.tables[0] }, classification: 'metadata' }],
      } as any,
    });
    vi.mocked(clickhouse.writeMigrationArtifacts).mockResolvedValue({
      migrationDir: '/repo/migrations/20260424210000_add_users',
      upPath: '',
      downPath: '',
      metaPath: '',
      planPath: '',
    });

    await generateMigrationCommand({ name: 'add users' });

    expect(clickhouse.writeMigrationArtifacts).toHaveBeenCalled();
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/'),
      expect.stringContaining('{"ok":true}'),
      'utf8',
    );
  });

  it('exits when the migration name is missing', async () => {
    const exitHandler = mockProcessExit();
    const { generateMigrationCommand } = await import('./generate-migration.js');

    await expect(generateMigrationCommand({})).rejects.toBeInstanceOf(ProcessExitError);
    exitHandler.restore();
  });

  it('exits when rendering fails for a blocked migration', async () => {
    const exitHandler = mockProcessExit();
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const { loadModule } = await import('../utils/load-api.js');
    const clickhouse = await import('@hypequery/clickhouse');
    const { generateMigrationCommand } = await import('./generate-migration.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', username: 'default', database: 'analytics' },
    });
    vi.mocked(loadModule).mockResolvedValue({
      default: { tables: [], materializedViews: [] },
    });
    vi.mocked(clickhouse.serializeSchemaToSnapshot).mockReturnValue({
      version: 1,
      dialect: 'clickhouse',
      tables: [],
      materializedViews: [],
      dependencies: [],
      contentHash: 'next-hash',
    });
    vi.mocked(clickhouse.diffSnapshots).mockReturnValue({
      previousSnapshot: { version: 1, dialect: 'clickhouse', tables: [], materializedViews: [], dependencies: [], contentHash: 'prev-hash' },
      nextSnapshot: { version: 1, dialect: 'clickhouse', tables: [], materializedViews: [], dependencies: [], contentHash: 'next-hash' },
      operations: [{ kind: 'DropTable', tableName: 'users' }],
      warnings: [],
      unsupportedChanges: [{ kind: 'PossibleRename', tableName: 'users', message: 'blocked' }],
    } as any);
    vi.mocked(clickhouse.renderMigrationArtifacts).mockImplementation(() => {
      throw new Error('Migration plan has blockers');
    });

    await expect(generateMigrationCommand({ name: 'drop users' })).rejects.toBeInstanceOf(ProcessExitError);
    exitHandler.restore();
  });
});
