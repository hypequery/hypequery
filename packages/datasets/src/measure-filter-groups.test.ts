/**
 * And/or/not fixed measure filters. A contract authored elsewhere (Cloud's
 * model editor, another language) may carry a `logical` measure filter; it
 * must rehydrate, so discovery and execution of that release keep working,
 * and it must rebuild the SQL the authored measure compiles (decision 0005;
 * `sql-equality.test.ts` runs the full gate).
 */

import { describe, expect, it } from 'vitest';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createPortableSemanticExecutor } from './portable-executor.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { eq } from './query-helpers.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

const PUBLIC = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
const settled = { or: [eq('status', 'paid'), eq('status', 'refunded')] };
const large = { and: [eq('status', 'paid'), { field: 'amount', operator: 'gt' as const, value: 100 }] };
const unrefunded = { not: eq('status', 'refunded') };

const Orders = dataset('orders', {
  source: 'analytics.orders',
  dimensions: { status: dimension.string(), amount: dimension.number() },
  measures: {
    settledRevenue: measure.sum('amount', { filters: [settled] }),
    largeRevenue: measure.sum('amount', { filters: [large, eq('status', 'paid')] }),
    unrefundedOrders: measure.count('status', { filters: [unrefunded] }),
  },
});

const reference = (name: string) => ({ kind: 'reference', name });
const literal = (value: unknown) => ({ kind: 'literal', value });
const comparison = (field: string, operator: string, value: unknown) => ({
  kind: 'comparison', operator, left: reference(field), right: literal(value),
});

function contract() {
  return buildProtocolDeploymentContract([Orders], { endpoints: { orders: PUBLIC } });
}

function sqlOf(registry: unknown, measures: string[]) {
  const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
  return client.toSQL((registry as Record<string, typeof Orders>).orders, { dimensions: ['status'], measures } as never);
}

describe('and/or/not measure filters', () => {
  it('publish as logical expressions, in authored order', () => {
    const measures = contract().datasets[0]!.measures as unknown as { name: string; filters: unknown[] }[];
    const filters = Object.fromEntries(measures.map(entry => [entry.name, entry.filters]));
    expect(filters.settledRevenue).toEqual([{
      kind: 'logical', operator: 'or',
      operands: [comparison('status', 'eq', 'paid'), comparison('status', 'eq', 'refunded')],
    }]);
    expect(filters.largeRevenue).toEqual([
      { kind: 'logical', operator: 'and', operands: [comparison('status', 'eq', 'paid'), comparison('amount', 'gt', 100)] },
      comparison('status', 'eq', 'paid'),
    ]);
    expect(filters.unrefundedOrders).toEqual([{ kind: 'logical', operator: 'not', operand: comparison('status', 'eq', 'refunded') }]);
  });

  it('rehydrate to the authored groups and the authored SQL', () => {
    const rebuilt = rehydrateProtocolDatasets(contract().datasets);
    const measures = rebuilt.orders!.measures as Record<string, { filters?: unknown }>;
    expect(measures.settledRevenue!.filters).toEqual([settled]);
    expect(measures.largeRevenue!.filters).toEqual([large, eq('status', 'paid')]);
    expect(measures.unrefundedOrders!.filters).toEqual([unrefunded]);
    const all = ['settledRevenue', 'largeRevenue', 'unrefundedOrders'];
    const authored = sqlOf({ orders: Orders }, all);
    expect(sqlOf(rebuilt, all)).toBe(authored);
    expect(authored).toContain(" OR ");
    expect(authored).toContain('NOT (');
  });

  it('keep a contract authored outside TypeScript discoverable and executable', async () => {
    // As Cloud's editor writes it: one `or` filter and a nested `and`.
    const deployment = structuredClone(contract()) as unknown as { datasets: { measures: { name: string; filters: unknown[] }[] }[] };
    deployment.datasets[0]!.measures.find(entry => entry.name === 'settledRevenue')!.filters = [{
      kind: 'logical', operator: 'or', operands: [
        comparison('status', 'eq', 'paid'),
        { kind: 'logical', operator: 'and', operands: [comparison('status', 'eq', 'refunded'), comparison('amount', 'gt', 0)] },
      ],
    }];
    const rebuilt = rehydrateProtocolDatasets(deployment.datasets as never);
    expect(projectAgentSafeCatalog(rebuilt as never).datasets.map(entry => entry.name)).toEqual(['orders']);

    const factory = createRenderingBuilderFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const dataset = deployment.datasets[0]!;
    await expect(execute({
      activationRevision: 'a'.repeat(64),
      deployment: deployment as never,
      dataset: dataset as never,
      operation: { kind: 'dataset', dataset: 'orders', measures: ['settledRevenue'] } as never,
      tenant: undefined,
      budget: { maxRows: 10 },
    } as never)).resolves.toBeDefined();
  });

  it('publish a one-item and/or as its item, at any depth, and rebuild the same SQL', () => {
    const Single = dataset('orders', {
      source: 'analytics.orders',
      dimensions: { status: dimension.string(), amount: dimension.number() },
      measures: {
        paid: measure.sum('amount', { filters: [{ or: [eq('status', 'paid')] }] }),
        paidLarge: measure.sum('amount', { filters: [{ and: [eq('status', 'paid'), { or: [{ and: [{ field: 'amount', operator: 'gt', value: 1 }] }] }] }] }),
        notPaid: measure.count('status', { filters: [{ not: { and: [eq('status', 'paid')] } }] }),
      },
    });
    const published = buildProtocolDeploymentContract([Single], { endpoints: { orders: PUBLIC } });
    const filters = Object.fromEntries((published.datasets[0]!.measures as unknown as { name: string; filters: unknown[] }[])
      .map(entry => [entry.name, entry.filters]));
    expect(filters.paid).toEqual([comparison('status', 'eq', 'paid')]);
    expect(filters.paidLarge).toEqual([{ kind: 'logical', operator: 'and', operands: [comparison('status', 'eq', 'paid'), comparison('amount', 'gt', 1)] }]);
    expect(filters.notPaid).toEqual([{ kind: 'logical', operator: 'not', operand: comparison('status', 'eq', 'paid') }]);
    const all = ['paid', 'paidLarge', 'notPaid'];
    expect(sqlOf(rehydrateProtocolDatasets(published.datasets), all)).toBe(sqlOf({ orders: Single }, all));
  });

  it('refuse a malformed group when the dataset is defined', () => {
    expect(() => dataset('orders', {
      source: 'analytics.orders',
      dimensions: { status: dimension.string(), amount: dimension.number() },
      measures: { bad: measure.sum('amount', { filters: [{ or: [] }] }) },
    })).toThrow(/needs a non-empty array/);
  });
});
