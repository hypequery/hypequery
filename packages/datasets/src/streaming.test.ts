import { describe, expect, it, vi } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatabaseAdapter } from '../../clickhouse/src/core/adapters/database-adapter.js';
import { belongsTo, createDatasetClient, dataset, dimension, divide, measure, nullIfZero, subtract } from './index.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import type { DatasetQuery, ExecutionContext, MetricFilter } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

const Customers = dataset('customers', {
  source: 'analytics.customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number({ column: 'customer_id' }),
    country: dimension.string({ column: 'country_code' }),
  },
  measures: { customers: measure.countDistinct('id') },
});

const Orders = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  final: true,
  limits: { maxResultSize: 500 },
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    customerId: dimension.number({ column: 'customer_id' }),
    status: dimension.string(),
    amount: dimension.number({ column: 'amount_cents', groupable: false }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    running: measure.cumulative('revenue'),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
    monthOverMonth: measure.derived({
      uses: { current: 'revenue', prior: 'priorMonth' },
      formula: ({ current, prior }) => subtract(current, prior),
    }),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
    createdAt: { __type: 'filter_definition', field: 'createdAt', operators: ['gte', 'lt', 'between'] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const revenueInput = Orders.metric('revenue', { measure: 'revenue' });
const ordersInput = Orders.metric('orders', { measure: 'orders' });
const aov = Orders.metric('aov', {
  uses: { revenue: revenueInput, orders: ordersInput },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
});

const TENANT: ExecutionContext = { runtime: { tenant: 'acme' } };
const RANGE: MetricFilter[] = [{ field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-04-01'] }];

const shapes: Record<string, DatasetQuery> = {
  'aggregate': { dimensions: ['status'], measures: ['revenue'], filters: [{ field: 'status', operator: 'eq', value: 'paid' }], limit: 10 },
  'derived': { dimensions: ['status'], measures: ['averageOrderValue'], limit: 10 },
  'having': { dimensions: ['customerId'], measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gt', value: 100 }], limit: 10 },
  'window': { by: 'day', measures: ['running'], filters: RANGE, limit: 100 },
  'shift': { by: 'month', measures: ['revenue', 'priorMonth'], filters: RANGE, limit: 10 },
  'composite shift formula': { by: 'month', measures: ['monthOverMonth'], filters: RANGE, limit: 10 },
  'relationship join': { dimensions: ['customer.country'], measures: ['revenue'], limit: 10 },
  'relationship measure': { dimensions: ['status'], measures: ['revenue', 'customer.customers'], limit: 10 },
};

type Call = { sql: string; params: unknown[]; options: Record<string, unknown> | undefined };

function fakeAdapter(batches: Record<string, unknown>[][] = [[{ status: 'paid', revenue: 12.5 }]]) {
  const calls = { query: [] as Call[], stream: [] as Call[], streamArrow: [] as Call[] };
  const record = (into: Call[]) => (sql: string, params: unknown[] = [], options?: object) => {
    into.push({ sql, params, options: options as Record<string, unknown> | undefined });
  };
  const adapter: DatabaseAdapter = {
    name: 'fake',
    async query<T>(sql: string, params?: unknown[], options?: object) {
      record(calls.query)(sql, params, options);
      return [] as T[];
    },
    async stream<T>(sql: string, params?: unknown[], options?: object) {
      record(calls.stream)(sql, params, options);
      return new ReadableStream<T[]>({
        start(controller) {
          for (const batch of batches) controller.enqueue(structuredClone(batch) as T[]);
          controller.close();
        },
      });
    },
    async streamArrow(sql: string, params?: unknown[], options?: object) {
      record(calls.streamArrow)(sql, params, options);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
    },
  };
  return { adapter, calls };
}

function clientFor(adapter: DatabaseAdapter) {
  return createDatasetClient({ queryBuilder: createQueryBuilder({ adapter }) });
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<T>) out.push(chunk);
  return out;
}

describe('dataset client streaming', () => {
  describe.each(['stream', 'streamArrow'] as const)('%s', (method) => {
    it.each(Object.entries(shapes))('runs the compiled %s query without the pagination over-fetch', async (_name, query) => {
      const { adapter, calls } = fakeAdapter();
      const client = clientFor(adapter);
      // execute() over-fetches one row for `hasMore`; a stream must not.
      const compiledLimit = query.limit!;

      const result = await client[method](Orders, query as never, TENANT);
      await readAll(result.data as ReadableStream<unknown>);

      const sent = calls[method];
      expect(sent).toHaveLength(1);
      expect(sent[0]!.sql).toBe(result.meta.sql);
      expect(sent[0]!.sql).toMatch(new RegExp(`LIMIT ${compiledLimit}\\b`));
      expect(sent[0]!.sql).not.toMatch(new RegExp(`LIMIT ${compiledLimit + 1}\\b`));
      expect(sent[0]!.sql).toContain('tenant_id = ');
      expect(sent[0]!.params).toContain('acme');
      expect(result.meta.tenant).toBe('acme');
      // Every preflight (the time-axis check) runs, and runs first.
      const preflights = client.compileDataset(Orders, query as never, TENANT).preflightStatements ?? [];
      expect(calls.query).toHaveLength(preflights.length);
    });

    it('keeps the FINAL safety settings on the builder plan', async () => {
      const { adapter, calls } = fakeAdapter();
      await clientFor(adapter)[method](Orders, shapes.aggregate as never, TENANT);

      expect(calls[method][0]!.options?.clickhouseSettings).toMatchObject({ optimize_move_to_prewhere_if_final: 0 });
    });

    it('applies the dataset ceiling to an unbounded query and reports it', async () => {
      const { adapter, calls } = fakeAdapter();
      const result = await clientFor(adapter)[method](Orders, { dimensions: ['status'], measures: ['revenue'] }, TENANT);

      expect(calls[method][0]!.sql).toMatch(/LIMIT 500\b/);
      expect(result.meta.resultLimit).toEqual({ maxResultSize: 500, applied: 500 });
    });

    it('rejects an invalid query before sending anything', async () => {
      const { adapter, calls } = fakeAdapter();
      const client = clientFor(adapter);

      await expect(client[method](Orders, { measures: ['revenue'], limit: 501 }, TENANT)).rejects.toThrow(/Invalid dataset query/);
      await expect(client[method](Orders, { measures: ['revenue'] })).rejects.toThrow(/tenant/);
      expect(calls[method]).toHaveLength(0);
    });

    it('streams metrics, base and derived', async () => {
      const { adapter, calls } = fakeAdapter([[{ status: 'paid', totalRevenue: 5 }]]);
      const client = clientFor(adapter);

      const base = await client[method](totalRevenue, { dimensions: ['status'], limit: 3 }, TENANT);
      await client[method](aov, { dimensions: ['status'] }, TENANT);

      expect(calls[method]).toHaveLength(2);
      expect(calls[method][0]!.sql).toMatch(/LIMIT 3\b/);
      expect(calls[method][0]!.sql).not.toMatch(/LIMIT 4\b/);
      expect(calls[method][1]!.sql).toMatch(/LIMIT 500\b/);
      expect(base.meta.sql).toBe(calls[method][0]!.sql);
    });

    it('forwards the abort signal', async () => {
      const { adapter, calls } = fakeAdapter();
      const controller = new AbortController();
      await clientFor(adapter)[method](Orders, shapes.derived as never, { ...TENANT, abortSignal: controller.signal });

      expect(calls[method][0]!.options?.abortSignal).toBe(controller.signal);
    });

    it('requires the queryBuilder execution path', async () => {
      const client = createDatasetClient({ backend: createInMemoryBackend({}) });
      await expect(client[method](Orders, shapes.aggregate as never, TENANT))
        .rejects.toThrow('Streaming requires the queryBuilder execution path.');
    });
  });

  it('serializes measures in each batch exactly as execute() does', async () => {
    const { adapter } = fakeAdapter([
      [{ status: 'paid', revenue: 12.5 }, { status: 'open', revenue: null }],
      [{ status: 'void', revenue: Number.NaN }],
    ]);
    const result = await clientFor(adapter).stream(Orders, { dimensions: ['status'], measures: ['revenue'] }, TENANT);

    expect(await readAll(result.data)).toEqual([
      [{ status: 'paid', revenue: '12.5' }, { status: 'open', revenue: null }],
      [{ status: 'void', revenue: null }],
    ]);
  });

  it('serializes the metric value in metric batches', async () => {
    const { adapter } = fakeAdapter([[{ status: 'paid', totalRevenue: 7 }]]);
    const result = await clientFor(adapter).stream(totalRevenue, { dimensions: ['status'] }, TENANT);

    expect(await readAll(result.data)).toEqual([[{ status: 'paid', totalRevenue: '7' }]]);
  });

  it('hands Arrow bytes through untouched', async () => {
    const { adapter } = fakeAdapter();
    const result = await clientFor(adapter).streamArrow(Orders, shapes.aggregate as never, TENANT);

    expect(await readAll(result.data)).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it('names what is missing when the builder cannot stream', async () => {
    const execute = vi.fn();
    const builder = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'toSQLWithParams') return () => ({ sql: 'SELECT 1', parameters: [] });
        if (prop === 'execute') return execute;
        if (prop === 'stream' || prop === 'streamArrow' || prop === 'then') return undefined;
        return () => builder;
      },
    });
    const factory: QueryBuilderFactoryLike = { table: () => builder as never, rawQuery: vi.fn() };
    const client = createDatasetClient({ queryBuilder: factory });
    const Plain = dataset('plain', {
      source: 'plain',
      dimensions: { status: dimension.string() },
      measures: { rows: measure.count('status') },
    });

    await expect(client.stream(Plain, { dimensions: ['status'], measures: ['rows'] }))
      .rejects.toThrow('needs a query builder with stream(); @hypequery/clickhouse provides it from 2.15.0.');
    await expect(client.streamArrow(Plain, { dimensions: ['status'], measures: ['rows'] }))
      .rejects.toThrow('needs a query builder with streamArrow()');
    await expect(client.stream(Plain, { measures: ['rows'], having: [{ measure: 'rows', operator: 'gt', value: 1 }] }))
      .rejects.toThrow('needs a query builder factory with rawStream()');
    expect(execute).not.toHaveBeenCalled();
  });
});
