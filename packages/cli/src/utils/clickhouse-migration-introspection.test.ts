import { describe, expect, it, vi } from 'vitest';
import { introspectClickHouseSchema } from './clickhouse-migration-introspection.js';

describe('clickhouse migration introspection', () => {
  it('builds a migration snapshot from system tables and columns', async () => {
    const close = vi.fn();
    const query = vi.fn(async ({ query: sql }: { query: string }) => {
      if (sql.includes("engine = 'MaterializedView'")) {
        return { json: async () => [] };
      }

      if (sql.includes('FROM system.tables')) {
        return {
          json: async () => [
            {
              name: 'events',
              engine: 'MergeTree',
              engine_full: 'MergeTree ORDER BY created_at SETTINGS index_granularity = 8192',
              sorting_key: 'created_at',
              primary_key: 'id',
              partition_key: 'toYYYYMM(created_at)',
              create_table_query: '',
              as_select: '',
            },
          ],
        };
      }

      return {
        json: async () => [
          {
            table: 'events',
            name: 'id',
            type: 'UUID',
            default_kind: '',
            default_expression: '',
            position: 1,
          },
          {
            table: 'events',
            name: 'created_at',
            type: 'DateTime',
            default_kind: 'DEFAULT',
            default_expression: 'now()',
            position: 2,
          },
        ],
      };
    });

    const snapshot = await introspectClickHouseSchema({
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      client: { query, close },
    });

    expect(snapshot).toMatchObject({
      version: 1,
      dialect: 'clickhouse',
      tables: [
        {
          name: 'events',
          columns: [
            { name: 'id', type: 'UUID' },
            {
              name: 'created_at',
              type: 'DateTime',
              default: { kind: 'sql', value: 'now()' },
            },
          ],
          engine: {
            type: 'MergeTree',
            orderBy: ['created_at'],
            primaryKey: ['id'],
            partitionBy: 'toYYYYMM(created_at)',
          },
          settings: {
            index_granularity: '8192',
          },
        },
      ],
    });
    expect(snapshot.contentHash).toEqual(expect.any(String));
    expect(close).not.toHaveBeenCalled();
  });

  it('filters included and excluded tables after introspection', async () => {
    const query = vi.fn(async ({ query: sql }: { query: string }) => {
      if (sql.includes("engine = 'MaterializedView'")) {
        return { json: async () => [] };
      }

      if (sql.includes('FROM system.tables')) {
        return {
          json: async () => [
            { name: 'events', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: '', primary_key: '', partition_key: '', create_table_query: '', as_select: '' },
            { name: 'users', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: '', primary_key: '', partition_key: '', create_table_query: '', as_select: '' },
          ],
        };
      }

      return {
        json: async () => [
          { table: 'events', name: 'id', type: 'UUID', default_kind: '', default_expression: '', position: 1 },
          { table: 'users', name: 'id', type: 'UUID', default_kind: '', default_expression: '', position: 1 },
        ],
      };
    });

    const snapshot = await introspectClickHouseSchema({
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      includeTables: ['events', 'users'],
      excludeTables: ['users'],
      client: { query, close: vi.fn() },
    });

    expect(snapshot.tables.map(table => table.name)).toEqual(['events']);
  });

  it('includes materialized views that depend on selected tables', async () => {
    const query = vi.fn(async ({ query: sql }: { query: string }) => {
      if (sql.includes("engine = 'MaterializedView'")) {
        return {
          json: async () => [
            {
              name: 'events_mv',
              engine: 'MaterializedView',
              engine_full: 'MaterializedView',
              sorting_key: '',
              primary_key: '',
              partition_key: '',
              create_table_query: 'CREATE MATERIALIZED VIEW events_mv TO events_daily AS SELECT toDate(created_at) AS date, count() AS total FROM events GROUP BY date',
              as_select: 'SELECT toDate(created_at) AS date, count() AS total FROM events GROUP BY date',
            },
          ],
        };
      }

      if (sql.includes('FROM system.tables')) {
        return {
          json: async () => [
            { name: 'events', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: 'created_at', primary_key: '', partition_key: '', create_table_query: '', as_select: '' },
            { name: 'events_daily', engine: 'SummingMergeTree', engine_full: 'SummingMergeTree ORDER BY date', sorting_key: 'date', primary_key: '', partition_key: '', create_table_query: '', as_select: '' },
          ],
        };
      }

      return {
        json: async () => [
          { table: 'events', name: 'created_at', type: 'DateTime', default_kind: '', default_expression: '', position: 1 },
          { table: 'events_daily', name: 'date', type: 'Date', default_kind: '', default_expression: '', position: 1 },
          { table: 'events_daily', name: 'total', type: 'UInt64', default_kind: '', default_expression: '', position: 2 },
        ],
      };
    });

    const snapshot = await introspectClickHouseSchema({
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      client: { query, close: vi.fn() },
    });

    expect(snapshot.materializedViews).toEqual([
      {
        name: 'events_mv',
        from: 'events',
        to: 'events_daily',
        select: 'SELECT toDate(created_at) AS date, count() AS total FROM events GROUP BY date',
      },
    ]);
    expect(snapshot.dependencies).toEqual([
      {
        from: 'events',
        to: 'events_mv',
        kind: 'table_to_materialized_view',
      },
    ]);
  });

  it('excludes materialized views when their target table is excluded', async () => {
    const query = vi.fn(async ({ query: sql }: { query: string }) => {
      if (sql.includes("engine = 'MaterializedView'")) {
        return {
          json: async () => [
            {
              name: 'events_mv',
              engine: 'MaterializedView',
              engine_full: 'MaterializedView',
              sorting_key: '',
              primary_key: '',
              partition_key: '',
              create_table_query: 'CREATE MATERIALIZED VIEW events_mv TO events_daily AS SELECT count() AS total FROM events',
              as_select: 'SELECT count() AS total FROM events',
            },
          ],
        };
      }

      if (sql.includes('FROM system.tables')) {
        return {
          json: async () => [
            { name: 'events', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: '', primary_key: '', partition_key: '', create_table_query: '', as_select: '' },
          ],
        };
      }

      return {
        json: async () => [
          { table: 'events', name: 'id', type: 'UUID', default_kind: '', default_expression: '', position: 1 },
        ],
      };
    });

    const snapshot = await introspectClickHouseSchema({
      credentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
      excludeTables: ['events_daily'],
      client: { query, close: vi.fn() },
    });

    expect(snapshot.materializedViews).toEqual([]);
    expect(snapshot.dependencies).toEqual([]);
  });
});
