import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure, divide, nullIfZero } from './index.js';
import { createDatasetClient } from './executor.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { buildDatasetInputSchema, buildMetricInputSchema } from './semantic-query-schema.js';
import { buildDatasetQueryBuilder } from './dataset-query.js';
import { prepareDatasetQuery } from './utils/compile-dataset-query.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetHavingCondition, DatasetQuery } from './types.js';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    customerId: dimension.string({ column: 'customer_id' }),
    status: dimension.string(),
    amount: dimension.number(),
    orderId: dimension.string({ column: 'order_id' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('orderId'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    runningRevenue: measure.cumulative('revenue'),
  },
  limits: { maxFilters: 3 },
});

const TENANT = { runtime: { tenant: { id: 'tenant-1' } } } as const;

/** A real ClickHouse builder whose adapter records what would be executed. */
function recordingClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [] as T[];
      },
    },
  });
  return { calls, client: createDatasetClient({ queryBuilder: db }) };
}

const having = (...conditions: DatasetHavingCondition[]): DatasetQuery => ({
  dimensions: ['customerId'],
  measures: ['revenue', 'orders'],
  having: conditions,
});

describe('dataset having conditions', () => {
  describe('SQL generation', () => {
    it('filters base measures after grouping and binds every value', async () => {
      const { client, calls } = recordingClient();
      const query = having(
        { measure: 'revenue', operator: 'gt', value: 10_000 },
        { measure: 'orders', operator: 'between', value: [2, 50] },
      );

      const sql = client.toSQL(Orders, query, TENANT);
      expect(sql).toMatch(/^WITH base AS \(SELECT .+ GROUP BY .+\) SELECT .+ FROM base WHERE /);
      expect(sql).toContain('WHERE `revenue` > ? AND `orders` BETWEEN ? AND ?');

      await client.execute(Orders, query, TENANT);
      expect(calls).toHaveLength(1);
      // The tenant predicate binds inside the grouped query, before any condition.
      expect(calls[0].params).toEqual(['tenant-1', 10_000, 2, 50]);
    });

    it('reads a derived measure through its expression, not its output alias', () => {
      const { client } = recordingClient();
      const sql = client.toSQL(Orders, {
        dimensions: ['customerId'],
        measures: ['averageOrderValue'],
        having: [{ measure: 'averageOrderValue', operator: 'gte', value: 50 }],
      }, TENANT);
      const [, where] = sql.split(' FROM base WHERE ');
      expect(where).toBe('((`revenue` / NULLIF(`orders`, 0))) >= ?');
    });

    it('keeps ordering and limits outside the condition', () => {
      const { client } = recordingClient();
      const sql = client.toSQL(Orders, {
        ...having({ measure: 'revenue', operator: 'in', value: [1, 2, 3] }),
        orderBy: [{ field: 'revenue', direction: 'desc' }],
        limit: 10,
      }, TENANT);
      expect(sql).toMatch(/WHERE `revenue` IN \(\?, \?, \?\) ORDER BY `revenue` DESC LIMIT 10$/);
    });

    it('leaves SQL unchanged when having is empty or absent', () => {
      const { client } = recordingClient();
      const base = { dimensions: ['customerId'], measures: ['revenue'] };
      expect(client.toSQL(Orders, { ...base, having: [] }, TENANT)).toBe(client.toSQL(Orders, base, TENANT));
      expect(client.toSQL(Orders, base, TENANT)).not.toContain('WITH base');
    });

    it('is refused by the builder-only helper, which cannot express it', () => {
      const db = createQueryBuilder({ host: 'http://localhost:8123' });
      expect(() => buildDatasetQueryBuilder(Orders, having({ measure: 'revenue', operator: 'gt', value: 1 }), {
        builderFactory: db, context: TENANT,
      })).toThrow(/needs the outer SQL projection/);
    });

    it('describes conditions without their values', () => {
      const db = createQueryBuilder({ host: 'http://localhost:8123' });
      const { compilation } = prepareDatasetQuery(
        Orders, having({ measure: 'revenue', operator: 'gt', value: 123_456 }), { builderFactory: db, context: TENANT },
      );
      expect(compilation.describe()).toMatchObject({ plan: 'aggregate', having: [{ measure: 'revenue', operator: 'gt' }] });
      expect(JSON.stringify(compilation)).not.toContain('123456');
    });
  });

  describe('validation', () => {
    const errorsFor = (query: DatasetQuery) => recordingClient().client.validate(Orders, query, TENANT).errors.join(' | ');

    it('requires the measure to be selected by the query', () => {
      expect(errorsFor({
        dimensions: ['customerId'],
        measures: ['orders'],
        having: [{ measure: 'revenue', operator: 'gt', value: 1 }],
      })).toContain('Having measure "revenue" must be one of the selected measures');
    });

    it('accepts the default measure selection when measures are omitted', () => {
      expect(errorsFor({
        dimensions: ['customerId'],
        having: [{ measure: 'revenue', operator: 'gt', value: 1 }],
      })).toBe('');
    });

    it.each([
      ['a dimension', { measure: 'status', operator: 'eq', value: 1 }],
      ['SQL text', { measure: 'revenue) OR (1=1', operator: 'gt', value: 1 }],
      ['a prototype key', { measure: 'constructor', operator: 'gt', value: 1 }],
    ])('rejects %s as the measure', (_label, condition) => {
      expect(errorsFor({ ...having(), having: [condition as DatasetHavingCondition] }))
        .toMatch(/must be one of the selected measures/);
    });

    it.each(['like', 'inSubquery', 'inTable', 'gt OR 1=1'])('rejects the "%s" operator', (operator) => {
      expect(errorsFor(having({ measure: 'revenue', operator, value: 1 } as unknown as DatasetHavingCondition)))
        .toContain(`Unsupported having operator "${operator}"`);
    });

    it.each([
      ['a string', 'gt', '100'],
      ['NaN', 'gt', Number.NaN],
      ['Infinity', 'lt', Number.POSITIVE_INFINITY],
      ['SQL text', 'eq', '1 OR 1=1'],
      ['a one-item between', 'between', [1]],
      ['a between of strings', 'between', ['1', '2']],
      ['an empty in-list', 'in', []],
      ['a scalar in-list', 'notIn', 5],
    ])('rejects %s as the value', (_label, operator, value) => {
      expect(errorsFor(having({ measure: 'revenue', operator, value } as unknown as DatasetHavingCondition)))
        .toMatch(/expects/);
    });

    it('rejects a non-array having', () => {
      expect(errorsFor({ ...having(), having: 'revenue > 1' as unknown as DatasetHavingCondition[] }))
        .toContain('Having must be an array of conditions.');
    });

    it('applies the dataset filter limit to having conditions', () => {
      const condition = { measure: 'revenue', operator: 'gt', value: 1 } as const;
      expect(errorsFor(having(condition, condition, condition, condition)))
        .toContain('Too many filters and having conditions: 4 (max 3)');
    });

    it('counts filters and having conditions together against the filter limit', () => {
      const condition = { measure: 'revenue', operator: 'gt', value: 1 } as const;
      const filter = { field: 'status', operator: 'eq', value: 'paid' } as const;
      expect(errorsFor({ ...having(condition, condition), filters: [filter, filter] }))
        .toContain('Too many filters and having conditions: 4 (max 3)');
      expect(errorsFor({ ...having(condition), filters: [filter, filter] })).toBe('');
    });

    it('rejects queries that select window or shift measures', () => {
      expect(errorsFor({
        measures: ['runningRevenue'],
        by: 'day',
        having: [{ measure: 'runningRevenue', operator: 'gt', value: 1 }],
      })).toContain('Having is not supported on queries that select window or shift measures.');
    });

    it('never reaches the database when invalid', async () => {
      const { client, calls } = recordingClient();
      const query = having({ measure: 'revenue', operator: 'inSubquery', value: 'SELECT 1' } as unknown as DatasetHavingCondition);
      await expect(Promise.resolve().then(() => client.execute(Orders, query, TENANT))).rejects.toThrow(/Unsupported having operator/);
      expect(calls).toEqual([]);
    });

    it('is refused on the deprecated semantic backend path', async () => {
      const client = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
      await expect(Promise.resolve().then(() => client.execute(
        Orders, having({ measure: 'revenue', operator: 'gt', value: 1 }), TENANT,
      ))).rejects.toThrow('Dataset having conditions require the queryBuilder execution path.');
    });
  });

  describe('cache signature', () => {
    const signature = (query: DatasetQuery) => buildDatasetQuerySignature(Orders, query, TENANT);

    it('partitions entries by condition and value', () => {
      const gt100 = signature(having({ measure: 'revenue', operator: 'gt', value: 100 }));
      expect(signature(having({ measure: 'revenue', operator: 'gt', value: 200 }))).not.toBe(gt100);
      expect(signature(having({ measure: 'revenue', operator: 'gte', value: 100 }))).not.toBe(gt100);
      expect(signature(having())).not.toBe(gt100);
    });

    it('keeps existing keys unchanged when there are no conditions', () => {
      const base = { dimensions: ['customerId'], measures: ['revenue'] };
      expect(signature({ ...base, having: [] })).toBe(signature(base));
      expect(signature(base)).not.toContain('having');
    });
  });

  describe('input schema', () => {
    const valid = { measures: ['revenue'], having: [{ measure: 'revenue', operator: 'between', value: [1, 2] }] };

    it('is opt-in, so existing schemas are unchanged by default', () => {
      expect(buildDatasetInputSchema(Orders).safeParse(valid).success).toBe(false);
      expect(buildDatasetInputSchema(Orders, { having: true }).safeParse(valid).success).toBe(true);
    });

    it('constrains measure names, operators and numeric values', () => {
      const schema = buildDatasetInputSchema(Orders, { having: true });
      const parse = (condition: unknown) => schema.safeParse({ measures: ['revenue'], having: [condition] }).success;
      expect(parse({ measure: 'status', operator: 'gt', value: 1 })).toBe(false);
      expect(parse({ measure: 'revenue', operator: 'like', value: 1 })).toBe(false);
      expect(parse({ measure: 'revenue', operator: 'gt', value: '1' })).toBe(false);
      expect(parse({ measure: 'revenue', operator: 'between', value: [1] })).toBe(false);
      expect(parse({ measure: 'revenue', operator: 'in', value: [] })).toBe(false);
      expect(parse({ measure: 'revenue', operator: 'gt', value: 1, extra: true })).toBe(false);
      expect(parse({ measure: 'averageOrderValue', operator: 'lte', value: 9.5 })).toBe(true);
    });

    it('is never offered on metric queries', () => {
      const metric = Orders.metric('totalRevenue', { measure: 'revenue' });
      const schema = buildMetricInputSchema(Orders, metric.name, { having: true });
      expect(schema.safeParse({ having: [{ measure: 'revenue', operator: 'gt', value: 1 }] }).success).toBe(false);
    });
  });
});
