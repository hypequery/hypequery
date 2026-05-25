import { describe, expect, it } from 'vitest';
import { sql } from '../utils/sql-tag.js';
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
          default: {
            kind: 'literal',
            value: 'pending',
          },
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

  it('supports raw ClickHouse column types for introspected schemas', () => {
    const table = defineTable('events', {
      columns: {
        tags: column.Raw('Array(String)'),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['tags'],
      },
    });

    expect(table.columns[0]?.type).toEqual({
      kind: 'named',
      name: 'Array(String)',
    });
  });

  it('supports common scalar ClickHouse types used by pulled schemas', () => {
    const table = defineTable('events', {
      columns: {
        active: column.Bool(),
        created_date32: column.Date32(),
        ip4: column.IPv4(),
        ip6: column.IPv6(),
        payload: column.JSON(),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['created_date32'],
      },
    });

    expect(table.columns.map(item => item.type)).toEqual([
      { kind: 'named', name: 'Bool' },
      { kind: 'named', name: 'Date32' },
      { kind: 'named', name: 'IPv4' },
      { kind: 'named', name: 'IPv6' },
      { kind: 'named', name: 'JSON' },
    ]);
  });
});
