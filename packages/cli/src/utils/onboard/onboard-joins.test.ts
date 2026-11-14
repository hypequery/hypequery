import { describe, expect, it } from 'vitest';
import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { declaredJoins, parseJoinPairs } from './onboard-joins.js';

const resolve = (dataset: ProtocolDeploymentContract['datasets'][number], field: string) =>
  dataset.dimensions.find(dimension => dimension.name === field)?.source.kind === 'column'
    ? (dataset.dimensions.find(dimension => dimension.name === field)!.source as { column: string }).column
    : field;

function dataset(name: string, source: string, relationships: unknown[] = [], dimensions: unknown[] = []) {
  return { name, source, relationships, dimensions } as unknown as ProtocolDeploymentContract['datasets'][number];
}

describe('parseJoinPairs', () => {
  it('reads child=parent pairs, with database-qualified tables', () => {
    expect(parseJoinPairs('orders.customer_id=customers.id, sales.orders.c=sales.customers.id')).toEqual([
      { child: { table: 'orders', column: 'customer_id' }, parent: { table: 'customers', column: 'id' } },
      { child: { table: 'sales.orders', column: 'c' }, parent: { table: 'sales.customers', column: 'id' } },
    ]);
    expect(parseJoinPairs(undefined)).toEqual([]);
  });

  it.each(['orders.customer_id', 'orders=customers.id', 'a.b=c.d=e.f', 'orders.=customers.id'])('refuses %s', (value) => {
    expect(() => parseJoinPairs(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});

describe('declaredJoins', () => {
  it('turns relationships into physical key pairs, child first', () => {
    const contract = {
      kind: 'hypequery-deployment',
      version: 2,
      datasets: [
        dataset('orders', 'orders', [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customerId', to: 'id', queryable: true }],
          [{ name: 'customerId', source: { kind: 'column', column: 'customer_id' } }]),
        dataset('customers', 'crm.customers', [{ name: 'orders', kind: 'hasMany', target: 'orders', from: 'id', to: 'customerId', queryable: true }]),
      ],
    } as unknown as ProtocolDeploymentContract;
    expect(declaredJoins(contract, resolve)).toEqual([
      { child: { table: 'orders', column: 'customer_id' }, parent: { table: 'crm.customers', column: 'id' }, relationship: 'orders.customer' },
      { child: { table: 'orders', column: 'customer_id' }, parent: { table: 'crm.customers', column: 'id' }, relationship: 'customers.orders' },
    ]);
  });

  it('skips relationships to unknown datasets or derived keys', () => {
    const contract = {
      kind: 'hypequery-deployment',
      version: 2,
      datasets: [dataset('orders', 'orders', [{ name: 'x', kind: 'belongsTo', target: 'missing', from: 'a', to: 'b', queryable: true }])],
    } as unknown as ProtocolDeploymentContract;
    expect(declaredJoins(contract, resolve)).toEqual([]);
    expect(declaredJoins({ ...contract, datasets: [dataset('a', 'a', [{ name: 'b', kind: 'belongsTo', target: 'a', from: 'k', to: 'k', queryable: true }])] } as ProtocolDeploymentContract, () => null)).toEqual([]);
  });
});
