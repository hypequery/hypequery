import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { add, divide, nullIfZero } from './formulas.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { serializeSemanticContract } from './contract.js';
import { buildDatasetInputSchema, buildMetricInputSchema } from './semantic-query-schema.js';
import { generateDatasetTools } from './tools.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { datasetOnTimeKey, datasetTimeKeys } from './utils/dataset-time-keys.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt', 'delivered_at'],
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
  },
  filters: {
    createdAt: { field: 'createdAt' },
    shippedAt: { field: 'shippedAt' },
  },
  measures: {
    revenue: measure.sum('amount'),
    priorRevenue: measure.shift('revenue', { amount: 1, unit: 'year' }),
    growth: measure.derived({
      uses: { revenue: 'revenue', prior: 'priorRevenue' },
      formula: ({ revenue, prior }) => divide(revenue, nullIfZero(prior)),
    }),
  },
});

const SingleAxis = dataset('single', {
  source: 'single',
  timeKey: 'created_at',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
const shippedRange = [{ field: 'shippedAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];
const createdRange = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];

describe('multiple time keys', () => {
  describe('definition', () => {
    it('keeps the default axis and stores the alternates without it', () => {
      expect(Orders.timeKey).toBe('createdAt');
      expect(Orders.timeKeys).toEqual(['shippedAt', 'delivered_at']);
      expect(Object.isFrozen(Orders.timeKeys)).toBe(true);
      expect(datasetTimeKeys(Orders)).toEqual(['createdAt', 'shippedAt', 'delivered_at']);
      const withDefault = dataset('d', { source: 'd', timeKey: 'a', timeKeys: ['a', 'b'], dimensions: {} });
      expect(withDefault.timeKeys).toEqual(['b']);
      expect('timeKeys' in SingleAxis).toBe(false);
    });

    it('rejects alternates without a default, duplicates, and unsafe columns', () => {
      expect(() => dataset('x', { source: 'x', timeKeys: ['a'], dimensions: {} }))
        .toThrow(/timeKeys requires timeKey/);
      expect(() => dataset('x', { source: 'x', timeKey: 'a', timeKeys: ['b', 'b'], dimensions: {} }))
        .toThrow(/must not contain duplicates/);
      expect(() => dataset('x', { source: 'x', timeKey: 'a', timeKeys: [''], dimensions: {} }))
        .toThrow(/non-empty strings/);
      expect(() => dataset('x', { source: 'x', timeKey: 'a', timeKeys: ['b; DROP TABLE x'], dimensions: {} }))
        .toThrow(/timeKeys/);
    });

    it('views a dataset on another axis without losing any', () => {
      const shipped = datasetOnTimeKey(Orders, 'shippedAt');
      expect(shipped.timeKey).toBe('shippedAt');
      expect(datasetTimeKeys(shipped)).toEqual(['shippedAt', 'createdAt', 'delivered_at']);
      expect(datasetOnTimeKey(shipped, 'shippedAt')).toBe(shipped);
      expect(datasetOnTimeKey(Orders, 'createdAt')).toBe(Orders);
      expect(datasetOnTimeKey(Orders, undefined)).toBe(Orders);
      expect(() => datasetOnTimeKey(Orders, 'missing')).toThrow(/Unknown timeKey "missing"/);
    });
  });

  describe('dataset queries', () => {
    it('buckets on the default axis unless the query selects another', () => {
      const byDefault = client.toSQL(Orders, { measures: ['revenue'], by: 'month' });
      expect(byDefault).toContain('created_at');
      expect(byDefault).not.toContain('shipped_at');
      expect(client.toSQL(Orders, { measures: ['revenue'], by: 'month', timeKey: 'createdAt' })).toBe(byDefault);

      const shipped = client.toSQL(Orders, { measures: ['revenue'], by: 'month', timeKey: 'shippedAt' });
      expect(shipped).toContain('shipped_at');
      expect(shipped).not.toContain('created_at');

      // A raw-column axis resolves like a raw-column timeKey.
      expect(client.toSQL(Orders, { measures: ['revenue'], by: 'day', timeKey: 'delivered_at' })).toContain('delivered_at');
    });

    it('rejects an axis the dataset does not declare', () => {
      expect(client.validate(Orders, { measures: ['revenue'], by: 'day', timeKey: 'missing' }).errors)
        .toContain('Unknown timeKey "missing" on dataset "orders". Available: createdAt, shippedAt, delivered_at');
      expect(client.validate(SingleAxis, { measures: ['revenue'], timeKey: 'other' }).valid).toBe(false);
      expect(client.validate(SingleAxis, { measures: ['revenue'], timeKey: 'created_at' }).valid).toBe(true);
      const noAxis = dataset('none', { source: 'none', dimensions: {}, measures: { n: measure.count('id') } });
      expect(client.validate(noAxis, { measures: ['n'], timeKey: 'x' }).errors.join(' ')).toContain('has no timeKey');
      expect(() => client.toSQL(Orders, { measures: ['revenue'], timeKey: 'missing' })).toThrow(/Invalid dataset query: .*Unknown timeKey/);
    });

    it('runs shift measures and their range checks on the selected axis', () => {
      // The bounded range must be on the axis the shift moves along.
      expect(client.validate(Orders, { measures: ['priorRevenue'], by: 'month', timeKey: 'shippedAt', filters: createdRange }).valid).toBe(false);
      expect(client.validate(Orders, { measures: ['priorRevenue'], by: 'month', timeKey: 'shippedAt', filters: shippedRange }).valid).toBe(true);
      expect(client.validate(Orders, { measures: ['growth'], by: 'month', filters: createdRange }).valid).toBe(true);

      const sql = client.toSQL(Orders, { measures: ['growth'], by: 'month', timeKey: 'shippedAt', filters: shippedRange });
      expect(sql).toContain('shipped_at');
      expect(client.toSQL(Orders, { measures: ['growth'], by: 'month', filters: createdRange })).not.toContain('shipped_at');
    });

    it('applies the query timezone to filters on every declared axis', () => {
      const sql = client.toSQL(Orders, {
        measures: ['revenue'],
        filters: [{ field: 'shippedAt', operator: 'gte', value: '2026-01-01' }],
        timezone: 'Asia/Tokyo',
      });
      expect(sql).toMatch(/shipped_at[^)]*'Asia\/Tokyo'/);
    });

    it('describes the selected axis in compilation diagnostics', () => {
      const compilation = client.compileDataset(Orders, { measures: ['revenue'], by: 'day', timeKey: 'shippedAt' });
      expect(compilation.describe().timeKey).toBe('shippedAt');
      expect(client.compileDataset(Orders, { measures: ['revenue'] }).describe().timeKey).toBeUndefined();
    });
  });

  describe('metric queries', () => {
    it('bucket base, grained and derived metrics on the selected axis', () => {
      const revenue = Orders.metric('totalRevenue', { measure: 'revenue' });
      expect(client.toSQL(revenue, { by: 'week' })).toContain('created_at');
      expect(client.toSQL(revenue, { by: 'week', timeKey: 'shippedAt' })).toContain('shipped_at');
      expect(client.toSQL(revenue.by('week'), { timeKey: 'shippedAt' })).toContain('shipped_at');

      const doubled = Orders.metric('doubled', {
        uses: { r: revenue },
        formula: ({ r }) => add(r, r),
      });
      expect(client.toSQL(doubled, { by: 'week', timeKey: 'shippedAt' })).toContain('shipped_at');

      expect(client.validate(revenue, { by: 'week', timeKey: 'missing' }).errors.join(' ')).toContain('Unknown timeKey');
    });
  });

  describe('row scope', () => {
    const Scoped = dataset('scoped', {
      source: 'scoped_orders',
      tenantKey: 'tenant_id',
      timeKey: 'createdAt',
      timeKeys: ['shippedAt'],
      dimensions: {
        status: dimension.string(),
        createdAt: dimension.timestamp({ column: 'created_at' }),
        shippedAt: dimension.timestamp({ column: 'shipped_at' }),
      },
      filters: { status: { field: 'status' }, shippedAt: { field: 'shippedAt' } },
      measures: {
        revenue: measure.sum('amount'),
        prior: measure.shift('revenue', { amount: 1, unit: 'year' }),
      },
    });
    const context = { runtime: { tenant: 'acme', constraints: [{ field: 'status', operator: 'eq' as const, value: 'paid' }] } };
    const revenue = Scoped.metric('scopedRevenue', { measure: 'revenue' });
    const shapes: [string, () => string][] = [
      ['aggregate', () => client.toSQL(Scoped, { measures: ['revenue'], by: 'month', timeKey: 'shippedAt' }, context)],
      ['shift', () => client.toSQL(Scoped, { measures: ['prior'], by: 'month', timeKey: 'shippedAt', filters: shippedRange }, context)],
      ['metric', () => client.toSQL(revenue, { by: 'month', timeKey: 'shippedAt' }, context)],
    ];

    it.each(shapes)('keeps tenant and enforced constraints on an alternate axis (%s)', (_shape, compile) => {
      const sql = compile();
      expect(sql).toContain('shipped_at');
      expect(sql).toContain("tenant_id = 'acme'");
      expect(sql).toContain("status = 'paid'");
    });

    it('refuses an alternate-axis query without the required tenant', () => {
      expect(client.validate(Scoped, { measures: ['revenue'], by: 'month', timeKey: 'shippedAt' }).valid).toBe(false);
    });
  });

  describe('backend path', () => {
    it('refuses an alternate axis but accepts the default by name', async () => {
      const backend = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
      await expect(async () => backend.execute(Orders, { measures: ['revenue'], by: 'day', timeKey: 'shippedAt' }))
        .rejects.toThrow(/Alternate time keys require the queryBuilder execution path/);
      await expect(backend.execute(Orders, { measures: ['revenue'], by: 'day', timeKey: 'createdAt' }))
        .resolves.toMatchObject({ data: [] });
    });
  });

  describe('catalog, contract and schemas', () => {
    it('publishes the alternates only when a dataset declares them', () => {
      expect(getDatasetCatalog(Orders).timeKeys).toEqual(['shippedAt', 'delivered_at']);
      expect('timeKeys' in getDatasetCatalog(SingleAxis)).toBe(false);
      const contract = serializeSemanticContract({ orders: Orders, single: SingleAxis });
      expect(contract.datasets.orders.timeKeys).toEqual(['delivered_at', 'shippedAt']);
      expect('timeKeys' in contract.datasets.single!).toBe(false);
    });

    it('accepts timeKey only where the surface opts in and the dataset has alternates', () => {
      const query = { measures: ['revenue'], by: 'day', timeKey: 'shippedAt' };
      expect(buildDatasetInputSchema(Orders).safeParse(query).success).toBe(false);
      expect(buildDatasetInputSchema(Orders, { timeKey: true }).safeParse(query).success).toBe(true);
      expect(buildDatasetInputSchema(Orders, { timeKey: true }).safeParse({ ...query, timeKey: 'missing' }).success).toBe(false);
      expect(buildDatasetInputSchema(SingleAxis, { timeKey: true }).safeParse({ measures: ['revenue'], timeKey: 'created_at' }).success).toBe(false);
      expect(buildMetricInputSchema(Orders, 'totalRevenue', { timeKey: true }, Orders.metric('totalRevenue', { measure: 'revenue' }).contract())
        .safeParse({ by: 'day', timeKey: 'shippedAt' }).success).toBe(true);
    });

    it.each([undefined, 'per-dataset'] as const)('passes the selected axis through generated tools (mode %s)', async mode => {
      const seen: unknown[] = [];
      const [tool] = generateDatasetTools({
        ...(mode ? { mode } : {}),
        datasets: { orders: Orders },
        analytics: { execute: async (_target: unknown, query: unknown) => { seen.push(query); return { data: [] }; } } as never,
      });
      const query = { measures: ['revenue'], by: 'day', timeKey: 'shippedAt' };
      await tool!.execute(mode ? query : { dataset: 'orders', ...query });
      expect(seen[0]).toMatchObject({ timeKey: 'shippedAt' });
    });
  });
});
