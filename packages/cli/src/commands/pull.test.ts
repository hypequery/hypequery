import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessExitError, mockProcessExit } from '../test-utils.js';

const accessMock = vi.fn().mockRejectedValue(new Error('missing'));
const mkdirMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => accessMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
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

const closeMock = vi.fn().mockResolvedValue(undefined);
const queryMock = vi.fn();
const createClientMock = vi.fn(() => ({
  query: queryMock,
  close: closeMock,
}));

vi.mock('@clickhouse/client', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('@hypequery/clickhouse', () => ({
  serializeSchemaToSnapshot: vi.fn(),
  snapshotToStableJson: vi.fn(() => '{"version":1}'),
}));

describe('pull command', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    accessMock.mockRejectedValue(new Error('missing'));
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    closeMock.mockResolvedValue(undefined);
    queryMock.mockReset();
  });

  it('writes a baseline schema file and 0000 snapshot', async () => {
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const clickhouse = await import('@hypequery/clickhouse');
    const { pullCommand } = await import('./pull.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', port: 8123, username: 'default', password: '', database: 'analytics' },
    });
    vi.mocked(clickhouse.serializeSchemaToSnapshot).mockReturnValue({
      version: 1,
      dialect: 'clickhouse',
      tables: [],
      materializedViews: [],
      dependencies: [],
      contentHash: 'baseline-hash',
    });

    queryMock
      .mockResolvedValueOnce({
        json: async () => [
          {
            name: 'users',
            engine: 'MergeTree',
            sorting_key: 'id',
            primary_key: 'id',
            partition_key: '',
            sampling_key: '',
            create_table_query: 'CREATE TABLE users (...) ENGINE = MergeTree ORDER BY id SETTINGS index_granularity = 8192',
          },
        ],
      })
      .mockResolvedValueOnce({
        json: async () => [
          {
            table: 'users',
            name: 'id',
            type: 'UInt64',
            default_kind: null,
            default_expression: null,
            position: 1,
          },
          {
            table: 'users',
            name: 'email',
            type: 'Nullable(String)',
            default_kind: 'DEFAULT',
            default_expression: '\'pending\'',
            position: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        json: async () => [{ name: 'users_mv' }],
      });

    await pullCommand();

    expect(createClientMock).toHaveBeenCalledWith({
      url: 'http://localhost:8123',
      username: 'default',
      password: '',
      database: 'analytics',
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('/src/schema.ts'),
      expect.stringContaining("const usersTable = defineTable"),
      'utf8',
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('migrations/meta/0000_snapshot.json'),
      expect.stringContaining('{"version":1}'),
      'utf8',
    );
    expect(closeMock).toHaveBeenCalled();
  });

  it('exits when the baseline already exists without --force', async () => {
    const exitHandler = mockProcessExit();
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const { pullCommand } = await import('./pull.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', username: 'default', password: '', database: 'analytics' },
    });
    accessMock.mockResolvedValueOnce(undefined);

    await expect(pullCommand()).rejects.toBeInstanceOf(ProcessExitError);
    expect(createClientMock).not.toHaveBeenCalled();
    exitHandler.restore();
  });
});
