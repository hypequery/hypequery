import { describe, expect, it, vi } from 'vitest';
import { introspectClickHouseSchema } from './clickhouse-migration-introspection.js';

describe('clickhouse migration introspection', () => {
  it('builds a migration snapshot from system tables and columns', async () => {
    const close = vi.fn();
    const query = vi.fn(async ({ query: sql }: { query: string }) => {
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
      if (sql.includes('FROM system.tables')) {
        return {
          json: async () => [
            { name: 'events', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: '', primary_key: '', partition_key: '' },
            { name: 'users', engine: 'MergeTree', engine_full: 'MergeTree', sorting_key: '', primary_key: '', partition_key: '' },
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
});
