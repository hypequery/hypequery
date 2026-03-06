import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryBuilder } from '../query-builder.js';
import { MemoryCacheProvider } from '../cache/providers/memory-lru.js';
import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import type { SqlDialect } from '../dialects/sql-dialect.js';

type TestSchema = {
  users: {
    id: 'UInt32';
    created_at: 'DateTime';
  };
};

describe('dialect seam', () => {
  const queryMock = vi.fn();
  const renderMock = vi.fn();
  const compileQueryMock = vi.fn();
  const formatTimeIntervalMock = vi.fn();
  const formatSettingsMock = vi.fn();

  const adapter: DatabaseAdapter = {
    name: 'test-adapter',
    query: (sql, params = []) => queryMock(sql, params),
    render: (sql, params = []) => renderMock(sql, params),
  };

  const dialect: SqlDialect = {
    name: 'test-dialect',
    compileQuery: (config, context) => compileQueryMock(config, context),
    formatTimeInterval: (column, interval, method) =>
      formatTimeIntervalMock(column, interval, method),
    formatSettings: (settings) => formatSettingsMock(settings),
  };

  beforeEach(() => {
    queryMock.mockReset();
    renderMock.mockReset();
    compileQueryMock.mockReset();
    formatTimeIntervalMock.mockReset();
    formatSettingsMock.mockReset();

    formatTimeIntervalMock.mockReturnValue('bucket(created_at, 1 day)');
    formatSettingsMock.mockReturnValue('max_execution_time=10');
    compileQueryMock.mockImplementation((config, context) => (
      `compiled:${context.tableName}:${config.groupBy?.join('|') ?? 'none'}:${config.settings ?? 'none'}`
    ));
    renderMock.mockImplementation((sql, params = []) => `rendered:${sql}:${params.join(',')}`);
    queryMock.mockResolvedValue([{ id: 1 }]);
  });

  it('uses injected dialect compilation and adapter execution end to end', async () => {
    const db = createQueryBuilder<TestSchema>({
      adapter,
      dialect,
      cache: {
        mode: 'cache-first',
        ttlMs: 10_000,
        provider: new MemoryCacheProvider({ maxEntries: 10 }),
      },
    });

    const query = db
      .table('users')
      .select(['id'])
      .where('id', 'eq', 42)
      .groupByTimeInterval('created_at', '1 day')
      .settings({ max_execution_time: 10 });

    expect(query.toSQL()).toBe(
      'rendered:compiled:users:bucket(created_at, 1 day):max_execution_time=10:42'
    );

    const first = await query.execute();
    const second = await query.execute();

    expect(first).toEqual([{ id: 1 }]);
    expect(second).toEqual(first);
    expect(formatTimeIntervalMock).toHaveBeenCalledWith(
      'created_at',
      '1 day',
      'toStartOfInterval',
    );
    expect(formatSettingsMock).toHaveBeenCalledWith({ max_execution_time: 10 });
    expect(compileQueryMock).toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      'compiled:users:bucket(created_at, 1 day):max_execution_time=10',
      [42],
    );
    expect(renderMock).toHaveBeenCalledWith(
      'compiled:users:bucket(created_at, 1 day):max_execution_time=10',
      [42],
    );
  });
});
