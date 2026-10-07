import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { dataset, dimension, measure, divide, nullIfZero, coalesce, round, eq, serializeSemanticContract, buildProtocolDeploymentContract } from './index.js';

function orders(portable: boolean) {
  return dataset('orders', { source: 'test_db.beta_derived', tenantKey: 'tenant_id',
    dimensions: { amount: dimension.number(), category: dimension.string(), status: dimension.string() },
    measures: {
      revenue: measure.sum('amount'), orders: measure.count('amount'), paidRevenue: measure.sum('amount', { filters: [eq('status', 'paid')] }),
      average: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
      ...(portable ? {} : { rounded: measure.derived({ uses: { average: 'average' }, formula: ({ average }) => round(average, 2) }) }),
      paidRate: measure.derived({ uses: { paidRevenue: 'paidRevenue', revenue: 'revenue' }, formula: ({ paidRevenue, revenue }) => coalesce(divide(paidRevenue, nullIfZero(revenue)), 0) }),
    },
  });
}

it('matches Python derived deployment and semantic contract fixtures', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../specs/datasets/${name}`, import.meta.url), 'utf8'));
  expect(buildProtocolDeploymentContract([orders(true)])).toEqual(fixture('derived-authoring-v1.json'));
  // JSON removes absent optional catalog metadata before comparing wire output.
  expect(JSON.parse(JSON.stringify(serializeSemanticContract({ orders: orders(false) })))).toEqual(fixture('derived-contract-v1.json'));
});
