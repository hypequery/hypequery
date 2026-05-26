import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, eq, measure } from '../../../datasets/dist/index.js';
import { checkDatasetsAgainstSchema } from './index.js';
import { sql } from '../index.js';
import { column, defineMaterializedView, defineSchema, defineTable } from '../schema/index.js';
import { serializeSchemaToSnapshot } from '../snapshot/index.js';

describe('check datasets against schema', () => {
  it('passes for a compatible dataset', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.number(),
        tenantId: dimension.string({ column: 'tenant_id' }),
        status: dimension.string(),
        createdAt: dimension.timestamp({ column: 'created_at' }),
      },
      measures: {
        revenue: measure.sum('amount'),
        completedRevenue: measure.sum('amount', {
          filters: [eq('status', 'completed')],
        }),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
              tenant_id: column.String(),
              status: column.String(),
              amount: column.Float64(),
              created_at: column.DateTime(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    expect(checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] })).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it('fails when a dataset source is missing', () => {
    const Orders = dataset('orders', {
      source: 'missing_orders',
      dimensions: {
        id: dimension.number(),
      },
    });

    const snapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MissingDatasetSource',
        datasetName: 'orders',
        sourceName: 'missing_orders',
      }),
    ]);
  });

  it('fails when a dimension column is missing', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        customerId: dimension.string({ column: 'customer_id' }),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MissingDimensionColumn',
          fieldName: 'customerId',
        }),
      ]),
    );
  });

  it('fails when a measure field is missing', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.number(),
      },
      measures: {
        revenue: measure.sum('amount'),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MissingMeasureField',
          fieldName: 'revenue',
        }),
      ]),
    );
  });

  it('fails when tenantKey or timeKey is missing', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.number(),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MissingTenantKey', fieldName: 'tenant_id' }),
        expect.objectContaining({ code: 'MissingTimeKey', fieldName: 'created_at' }),
      ]),
    );
  });

  it('fails when a filtered measure references a missing filter field', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.number(),
        status: dimension.string(),
      },
      measures: {
        completedRevenue: measure.sum('amount', {
          filters: [eq('missingField', 'completed')],
        }),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
              status: column.String(),
              amount: column.Float64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'InvalidMeasureFilterField',
          fieldName: 'missingField',
        }),
      ]),
    );
  });

  it('fails for non-numeric sum and avg measures but allows count', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.number(),
        status: dimension.string(),
      },
      measures: {
        revenue: measure.sum('status'),
        averageStatus: measure.avg('status'),
        statusCount: measure.count('status'),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
              status: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'IncompatibleNumericMeasureType',
          fieldName: 'revenue',
        }),
        expect.objectContaining({
          code: 'IncompatibleNumericMeasureType',
          fieldName: 'averageStatus',
        }),
      ]),
    );
    expect(report.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: 'statusCount',
        }),
      ]),
    );
  });

  it('resolves materialized view sources through their target table', () => {
    const DailyRevenue = dataset('dailyRevenue', {
      source: 'daily_revenue_mv',
      dimensions: {
        day: dimension.timestamp(),
      },
      measures: {
        revenue: measure.sum('revenue'),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('daily_revenue', {
            columns: {
              day: column.Date(),
              revenue: column.Float64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['day'],
            },
          }),
        ],
        materializedViews: [
          defineMaterializedView('daily_revenue_mv', {
            from: 'orders',
            to: 'daily_revenue',
            select: sql`SELECT toDate(created_at) AS day, sum(amount) AS revenue FROM orders GROUP BY day`,
          }),
        ],
      }),
    );

    expect(checkDatasetsAgainstSchema({ snapshot, datasets: [DailyRevenue] })).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it('fails when relationship source or target join columns are missing', () => {
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: {
        id: dimension.number(),
      },
    });

    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.number(),
        customerId: dimension.number({ column: 'customer_id' }),
      },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
          defineTable('customers', {
            columns: {
              name: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['name'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MissingRelationshipSourceColumn',
          fieldName: 'customer.from',
          physicalColumnName: 'customer_id',
        }),
        expect.objectContaining({
          code: 'MissingRelationshipTargetColumn',
          fieldName: 'customer.to',
          physicalColumnName: 'id',
        }),
      ]),
    );
  });

  it('reports SQL-expression compatibility limitations and checks simple SQL column references', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        netAmount: dimension.number({ sql: 'missing_amount' }),
        amountBucket: dimension.string({ sql: 'multiIf(amount > 100, "large", "small")' }),
      },
      measures: {
        netRevenue: measure.sum('amount', { sql: 'missing_amount' }),
        computedRevenue: measure.sum('amount', { sql: 'amount - discount' }),
      },
    });

    const snapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
              amount: column.Float64(),
              discount: column.Float64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const report = checkDatasetsAgainstSchema({ snapshot, datasets: [Orders] });

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'LimitedSqlExpressionCompatibility',
          level: 'warning',
          fieldName: 'netAmount',
        }),
        expect.objectContaining({
          code: 'LimitedSqlExpressionCompatibility',
          level: 'warning',
          fieldName: 'amountBucket',
        }),
        expect.objectContaining({
          code: 'MissingDimensionColumn',
          fieldName: 'netAmount',
          physicalColumnName: 'missing_amount',
        }),
        expect.objectContaining({
          code: 'MissingMeasureField',
          fieldName: 'netRevenue',
          physicalColumnName: 'missing_amount',
        }),
      ]),
    );
  });
});
