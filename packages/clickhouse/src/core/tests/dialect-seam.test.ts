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

  const adapter: DatabaseAdapter = {
    name: 'test-adapter',
    query: (sql, params = [], options) => queryMock(sql, params, options),
    render: (sql, params = []) => renderMock(sql, params),
  };

  const dialect: SqlDialect = {
    name: 'test-dialect',
    compileQuery: (config, context) => compileQueryMock(config, context),
    formatTimeInterval: (column, interval, method) =>
      formatTimeIntervalMock(column, interval, method),
    formatSettings: () => '',
  };

  beforeEach(() => {
    queryMock.mockReset();
    renderMock.mockReset();
    compileQueryMock.mockReset();
    formatTimeIntervalMock.mockReset();

    formatTimeIntervalMock.mockReturnValue('bucket(created_at, 1 day)');
    compileQueryMock.mockImplementation((config, context) => ({
      query: `compiled:${context.tableName}:${config.groupBy?.map((item: any) => typeof item === 'string' ? item : item.expression).join('|') ?? 'none'}:${JSON.stringify(config.settings ?? null)}`,
      parameters: [42],
    }));
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
      'rendered:compiled:users:bucket(created_at, 1 day):{"max_execution_time":10}:42'
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
    expect(compileQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { max_execution_time: 10 },
      }),
      expect.anything(),
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      'compiled:users:bucket(created_at, 1 day):{"max_execution_time":10}',
      [42],
      {
        clickhouseSettings: { max_execution_time: 10 },
        queryId: undefined,
      },
    );
    expect(renderMock).toHaveBeenCalledWith(
      'compiled:users:bucket(created_at, 1 day):{"max_execution_time":10}',
      [42],
    );
  });

  it('passes a root select-query node into injected dialects', () => {
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
      .orderBy('id', 'DESC');

    query.toSQL();

    expect(compileQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'select-query',
        from: { kind: 'table', name: 'users' },
        select: [{ kind: 'selection', selection: 'id' }],
        orderBy: [{ kind: 'order-by-item', column: 'id', direction: 'DESC' }],
      }),
      expect.anything(),
    );
  });
});
