import { describe, expect, it } from 'vitest';

import { createInMemoryBackend } from './in-memory-backend.js';
import type { PlanNode } from './semantic-plan.js';

const rows = [
  { id: '1', tenant_id: 't1', status: 'completed', category: 'software', amount: 100, cost: 30, customer_id: 'c1', created_at: '2024-01-02T10:00:00.000Z' },
  { id: '2', tenant_id: 't1', status: 'pending', category: 'hardware', amount: 50, cost: 20, customer_id: 'c2', created_at: '2024-01-08T10:00:00.000Z' },
  { id: '3', tenant_id: 't2', status: 'completed', category: 'software', amount: 200, cost: 120, customer_id: 'c1', created_at: '2024-02-15T10:00:00.000Z' },
  { id: '4', tenant_id: 't1', status: 'refunded', category: 'services', amount: 0, cost: 5, customer_id: 'c3', created_at: '2024-04-01T10:00:00.000Z' },
];

const aggregatePlan = (overrides: Partial<Extract<PlanNode, { kind: 'aggregate' }>> = {}): Extract<PlanNode, { kind: 'aggregate' }> => ({
  kind: 'aggregate',
  source: 'orders',
  dimensions: [],
  aggregations: [],
  filters: [],
  ...overrides,
});

describe('createInMemoryBackend aggregate plans', () => {
  it('applies filter operators', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const cases = [
      { field: 'status', operator: 'eq', value: 'completed', expected: 2 },
      { field: 'status', operator: 'neq', value: 'completed', expected: 2 },
      { field: 'amount', operator: 'gt', value: 75, expected: 2 },
      { field: 'amount', operator: 'gte', value: 100, expected: 2 },
      { field: 'amount', operator: 'lt', value: 75, expected: 2 },
      { field: 'amount', operator: 'lte', value: 50, expected: 2 },
      { field: 'status', operator: 'in', value: ['completed', 'pending'], expected: 3 },
      { field: 'status', operator: 'notIn', value: ['completed', 'pending'], expected: 1 },
      { field: 'amount', operator: 'between', value: [50, 150], expected: 2 },
      { field: 'category', operator: 'like', value: '%ware%', expected: 3 },
    ] as const;

    for (const testCase of cases) {
      const result = await backend.execute(aggregatePlan({
        filters: [{ field: testCase.field, operator: testCase.operator, value: testCase.value }],
        aggregations: [{ name: 'count', aggregation: 'count', field: 'id' }],
      }));

      expect(result.data).toEqual([{ count: testCase.expected }]);
    }
  });

  it('groups by dimensions and applies aggregate filters', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const result = await backend.execute(aggregatePlan({
      dimensions: [{ name: 'category', field: 'category' }],
      aggregations: [
        { name: 'revenue', aggregation: 'sum', field: 'amount' },
        { name: 'completedRevenue', aggregation: 'sum', field: 'amount', filters: [{ field: 'status', operator: 'eq', value: 'completed' }] },
        { name: 'orders', aggregation: 'count', field: 'id' },
      ],
      orderBy: [{ field: 'category', direction: 'asc' }],
    }));

    expect(result.data).toEqual([
      { category: 'hardware', revenue: 50, completedRevenue: 0, orders: 1 },
      { category: 'services', revenue: 0, completedRevenue: 0, orders: 1 },
      { category: 'software', revenue: 300, completedRevenue: 300, orders: 2 },
    ]);
  });

  it('computes all aggregate types', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const result = await backend.execute(aggregatePlan({
      aggregations: [
        { name: 'sum', aggregation: 'sum', field: 'amount' },
        { name: 'count', aggregation: 'count', field: 'id' },
        { name: 'distinctCustomers', aggregation: 'countDistinct', field: 'customer_id' },
        { name: 'avg', aggregation: 'avg', field: 'amount' },
        { name: 'min', aggregation: 'min', field: 'amount' },
        { name: 'max', aggregation: 'max', field: 'amount' },
      ],
    }));

    expect(result.data).toEqual([
      { sum: 350, count: 4, distinctCustomers: 3, avg: 87.5, min: 0, max: 200 },
    ]);
  });

  it('applies tenant scoping with eq and in operators', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const eqResult = await backend.execute(aggregatePlan({
      tenant: { field: 'tenant_id', operator: 'eq', value: 't1' },
      aggregations: [{ name: 'revenue', aggregation: 'sum', field: 'amount' }],
    }));
    const inResult = await backend.execute(aggregatePlan({
      tenant: { field: 'tenant_id', operator: 'in', value: ['t2'] },
      aggregations: [{ name: 'revenue', aggregation: 'sum', field: 'amount' }],
    }));

    expect(eqResult.data).toEqual([{ revenue: 150 }]);
    expect(inResult.data).toEqual([{ revenue: 200 }]);
  });

  it('buckets date grains and passes through non-date values', async () => {
    const backend = createInMemoryBackend({
      orders: [...rows, { id: '5', tenant_id: 't1', status: 'completed', category: 'legacy', amount: 25, created_at: 'not-a-date' }],
    });

    await expect(backend.execute(aggregatePlan({
      grain: { field: 'created_at', unit: 'year', output: 'period' },
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
      orderBy: [{ field: 'period', direction: 'asc' }],
    }))).resolves.toMatchObject({ data: [{ period: '2024-01-01', orders: 4 }, { period: 'not-a-date', orders: 1 }] });

    await expect(backend.execute(aggregatePlan({
      grain: { field: 'created_at', unit: 'quarter', output: 'period' },
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
      orderBy: [{ field: 'period', direction: 'asc' }],
    }))).resolves.toMatchObject({ data: [
      { period: '2024-01-01', orders: 3 },
      { period: '2024-04-01', orders: 1 },
      { period: 'not-a-date', orders: 1 },
    ] });

    await expect(backend.execute(aggregatePlan({
      grain: { field: 'created_at', unit: 'month', output: 'period' },
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
      orderBy: [{ field: 'period', direction: 'asc' }],
    }))).resolves.toMatchObject({ data: [
      { period: '2024-01-01', orders: 2 },
      { period: '2024-02-01', orders: 1 },
      { period: '2024-04-01', orders: 1 },
      { period: 'not-a-date', orders: 1 },
    ] });

    await expect(backend.execute(aggregatePlan({
      grain: { field: 'created_at', unit: 'week', output: 'period', weekStart: 0 },
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
      orderBy: [{ field: 'period', direction: 'asc' }],
    }))).resolves.toMatchObject({ data: [
      { period: '2023-12-31', orders: 1 },
      { period: '2024-01-07', orders: 1 },
      { period: '2024-02-11', orders: 1 },
      { period: '2024-03-31', orders: 1 },
      { period: 'not-a-date', orders: 1 },
    ] });

    await expect(backend.execute(aggregatePlan({
      grain: { field: 'created_at', unit: 'day', output: 'period' },
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
      orderBy: [{ field: 'period', direction: 'asc' }],
      limit: 1,
    }))).resolves.toMatchObject({ data: [{ period: '2024-01-02', orders: 1 }] });
  });

  it('applies order, offset, and limit', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const result = await backend.execute(aggregatePlan({
      dimensions: [{ name: 'category', field: 'category' }],
      aggregations: [{ name: 'revenue', aggregation: 'sum', field: 'amount' }],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      offset: 1,
      limit: 1,
    }));

    expect(result.data).toEqual([{ category: 'hardware', revenue: 50 }]);
  });

  it('returns one aggregate row for empty global groups', async () => {
    const backend = createInMemoryBackend({ orders: [] });

    const result = await backend.execute(aggregatePlan({
      aggregations: [{ name: 'orders', aggregation: 'count', field: 'id' }],
    }));

    expect(result.data).toEqual([{ orders: 0 }]);
  });
});

describe('createInMemoryBackend derive plans', () => {
  it('evaluates binary expressions and functions', async () => {
    const backend = createInMemoryBackend({ orders: rows });
    const input = aggregatePlan({
      aggregations: [
        { name: 'revenue', aggregation: 'sum', field: 'amount' },
        { name: 'cost', aggregation: 'sum', field: 'cost' },
        { name: 'orders', aggregation: 'count', field: 'id' },
        { name: 'zero', aggregation: 'sum', field: 'missing' },
      ],
    });

    const result = await backend.execute({
      kind: 'derive',
      input,
      metrics: [
        { name: 'profit', expression: { kind: 'binary', operator: 'subtract', left: { kind: 'ref', name: 'revenue' }, right: { kind: 'ref', name: 'cost' } } },
        { name: 'doubleRevenue', expression: { kind: 'binary', operator: 'multiply', left: { kind: 'ref', name: 'revenue' }, right: { kind: 'literal', value: 2 } } },
        { name: 'revenuePlusCost', expression: { kind: 'binary', operator: 'add', left: { kind: 'ref', name: 'revenue' }, right: { kind: 'ref', name: 'cost' } } },
        { name: 'average', expression: { kind: 'function', name: 'round', args: [{ kind: 'binary', operator: 'divide', left: { kind: 'ref', name: 'revenue' }, right: { kind: 'ref', name: 'orders' } }, { kind: 'literal', value: 1 }] } },
        { name: 'divideByZero', expression: { kind: 'binary', operator: 'divide', left: { kind: 'ref', name: 'revenue' }, right: { kind: 'literal', value: 0 } } },
        { name: 'coalesced', expression: { kind: 'function', name: 'coalesce', args: [{ kind: 'function', name: 'nullIfZero', args: [{ kind: 'ref', name: 'zero' }] }, { kind: 'literal', value: 99 }] } },
        { name: 'floor', expression: { kind: 'function', name: 'floor', args: [{ kind: 'literal', value: 3.9 }] } },
        { name: 'ceil', expression: { kind: 'function', name: 'ceil', args: [{ kind: 'literal', value: 3.1 }] } },
      ],
    });

    expect(result.data).toEqual([{
      profit: 175,
      doubleRevenue: 700,
      revenuePlusCost: 525,
      average: 87.5,
      divideByZero: null,
      coalesced: 99,
      floor: 3,
      ceil: 4,
    }]);
  });

  it('keeps aggregate dimensions and grain, then applies ordering and pagination', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const result = await backend.execute({
      kind: 'derive',
      input: aggregatePlan({
        dimensions: [{ name: 'category', field: 'category' }],
        grain: { field: 'created_at', unit: 'month', output: 'period' },
        aggregations: [{ name: 'revenue', aggregation: 'sum', field: 'amount' }],
      }),
      metrics: [
        { name: 'revenue', expression: { kind: 'ref', name: 'revenue' } },
        { name: 'revenueRounded', expression: { kind: 'function', name: 'round', args: [{ kind: 'ref', name: 'revenue' }] } },
      ],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      offset: 1,
      limit: 2,
    });

    expect(result.data).toEqual([
      { period: '2024-01-01', category: 'software', revenue: 100, revenueRounded: 100 },
      { period: '2024-01-01', category: 'hardware', revenue: 50, revenueRounded: 50 },
    ]);
  });

  it('orders derived metrics by aliases that only exist on the derive node', async () => {
    const backend = createInMemoryBackend({ orders: rows });

    const result = await backend.execute({
      kind: 'derive',
      input: aggregatePlan({
        dimensions: [{ name: 'category', field: 'category' }],
        aggregations: [
          { name: 'revenue', aggregation: 'sum', field: 'amount' },
          { name: 'orders', aggregation: 'count', field: 'id' },
        ],
      }),
      metrics: [
        {
          name: 'averageRevenue',
          expression: {
            kind: 'binary',
            operator: 'divide',
            left: { kind: 'ref', name: 'revenue' },
            right: { kind: 'ref', name: 'orders' },
          },
        },
      ],
      orderBy: [{ field: 'averageRevenue', direction: 'desc' }],
      limit: 1,
    });

    expect(result.data).toEqual([{ category: 'software', averageRevenue: 150 }]);
  });
});
