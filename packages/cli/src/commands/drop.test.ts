import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessExitError, mockProcessExit } from '../test-utils.js';

const readdirMock = vi.fn();
const rmMock = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => readdirMock(...args),
  rm: (...args: unknown[]) => rmMock(...args),
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

describe('drop command', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rmMock.mockResolvedValue(undefined);
  });

  it('removes the latest generated migration and matching snapshot', async () => {
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const { dropCommand } = await import('./drop.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', username: 'default', password: '', database: 'analytics' },
    });
    readdirMock.mockResolvedValue([
      { name: 'meta', isDirectory: () => true },
      { name: '20260424210000_add_users', isDirectory: () => true },
      { name: '20260424220000_add_orders', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false },
    ]);

    await dropCommand();

    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining('/migrations/20260424220000_add_orders'),
      { recursive: true, force: true },
    );
    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining('/migrations/meta/20260424220000_add_orders_snapshot.json'),
      { force: true },
    );
  });

  it('exits when no generated migrations exist', async () => {
    const exitHandler = mockProcessExit();
    const { loadHypequeryConfig } = await import('../utils/load-hypequery-config.js');
    const { dropCommand } = await import('./drop.js');

    vi.mocked(loadHypequeryConfig).mockResolvedValue({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      migrations: { out: './migrations', table: '_hypequery_migrations', prefix: 'timestamp' },
      dbCredentials: { host: 'localhost', username: 'default', password: '', database: 'analytics' },
    });
    readdirMock.mockResolvedValue([{ name: 'meta', isDirectory: () => true }]);

    await expect(dropCommand()).rejects.toBeInstanceOf(ProcessExitError);
    expect(rmMock).not.toHaveBeenCalled();
    exitHandler.restore();
  });
});
