import { describe, expect, it } from 'vitest';
import { sql } from '../../dataset/sql-tag.js';
import { column, defineMaterializedView, defineSchema, defineTable } from './index.js';

describe('migration schema DSL', () => {
  it('builds table and materialized view definitions from the DSL', () => {
    const orders = defineTable('orders', {
      columns: {
        id: column.UInt64(),
        status: column.LowCardinality('String').default('pending'),
        created_at: column.DateTime(),
        total: column.Decimal(10, 2).nullable(),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['created_at', 'id'],
        partitionBy: sql`
          toYYYYMM(created_at)
        `,
      },
      settings: {
        index_granularity: 8192,
      },
    });

    const ordersByDay = defineMaterializedView('orders_by_day', {
      from: orders,
      to: 'orders_daily_summary',
      select: sql`
        SELECT
          toDate(created_at) AS day,
          sum(total) AS revenue
        FROM orders
        GROUP BY day
      `,
    });

    const schema = defineSchema({
      tables: [orders],
      materializedViews: [ordersByDay],
    });

    expect(schema.tables[0]).toEqual({
      kind: 'table',
      name: 'orders',
      columns: [
        {
          name: 'id',
          type: { kind: 'named', name: 'UInt64' },
        },
        {
          name: 'status',
          type: {
            kind: 'low_cardinality',
            inner: { kind: 'named', name: 'String' },
          },
          default: 'pending',
        },
        {
          name: 'created_at',
          type: { kind: 'named', name: 'DateTime' },
        },
        {
          name: 'total',
          type: {
            kind: 'nullable',
            inner: { kind: 'named', name: 'Decimal', arguments: [10, 2] },
          },
        },
      ],
      engine: {
        type: 'MergeTree',
        orderBy: ['created_at', 'id'],
        partitionBy: expect.objectContaining({
          sql: '\n          toYYYYMM(created_at)\n        ',
        }),
      },
      settings: {
        index_granularity: 8192,
      },
    });

    expect(schema.materializedViews).toEqual([
      {
        kind: 'materialized_view',
        name: 'orders_by_day',
        from: 'orders',
        to: 'orders_daily_summary',
        select: expect.any(Object),
      },
    ]);
  });
});
