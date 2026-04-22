import { describe, expect, it } from 'vitest';
import { sql } from '../../dataset/sql-tag.js';
import type { ClickHouseSchemaAst } from '../schema/types.js';
import { serializeSchemaToSnapshot, snapshotToStableJson } from './serialize.js';

describe('serialize schema to snapshot', () => {
  it('normalizes schema ordering into a stable snapshot', () => {
    const schemaA: ClickHouseSchemaAst = {
      tables: [
        {
          kind: 'table',
          name: 'orders',
          columns: [
            {
              name: 'user_id',
              type: { kind: 'named', name: 'UInt64' },
            },
            {
              name: 'created_at',
              type: { kind: 'named', name: 'DateTime' },
            },
          ],
          engine: {
            type: 'MergeTree',
            orderBy: ['created_at', 'user_id'],
            partitionBy: sql`
              toYYYYMM(created_at)
            `,
          },
          settings: {
            index_granularity: 8192,
            allow_nullable_key: true,
          },
        },
      ],
      materializedViews: [
        {
          kind: 'materialized_view',
          name: 'orders_by_day',
          from: 'orders',
          to: 'orders_daily_summary',
          select: sql`
            SELECT
              toDate(created_at) AS day,
              count() AS order_count
            FROM orders
            GROUP BY day
          `,
        },
      ],
    };

    const schemaB: ClickHouseSchemaAst = {
      tables: [
        {
          kind: 'table',
          name: 'orders',
          columns: [
            {
              name: 'created_at',
              type: { kind: 'named', name: 'DateTime' },
            },
            {
              name: 'user_id',
              type: { kind: 'named', name: 'UInt64' },
            },
          ],
          engine: {
            type: 'MergeTree',
            orderBy: ['created_at', 'user_id'],
            partitionBy: 'toYYYYMM(created_at)',
          },
          settings: {
            allow_nullable_key: true,
            index_granularity: 8192,
          },
        },
      ],
      materializedViews: [
        {
          kind: 'materialized_view',
          name: 'orders_by_day',
          from: 'orders',
          to: 'orders_daily_summary',
          select: 'SELECT\n  toDate(created_at) AS day,\n  count() AS order_count\nFROM orders\nGROUP BY day',
        },
      ],
    };

    const snapshotA = serializeSchemaToSnapshot(schemaA);
    const snapshotB = serializeSchemaToSnapshot(schemaB);

    expect(snapshotA).toEqual(snapshotB);
    expect(snapshotToStableJson(snapshotA)).toContain('"contentHash"');
    expect(snapshotA.dependencies).toEqual([
      {
        from: 'orders',
        to: 'orders_by_day',
        kind: 'table_to_materialized_view',
      },
    ]);
  });
});
