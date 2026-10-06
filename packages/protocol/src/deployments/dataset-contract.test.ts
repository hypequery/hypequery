import { describe, expect, it } from 'vitest';
import { validateProtocolDatasetContract } from './index.js';

function dataset(metrics: unknown[] = []) {
  return {
    name: 'orders', source: 'orders', tenant: { kind: 'not-required' },
    dimensions: [], measures: [], filters: [], metrics, relationships: [],
  };
}

function derivedMetric() {
  const revenue = { kind: 'aggregate', aggregation: 'sum', field: 'amount' };
  const orders = { kind: 'aggregate', aggregation: 'count', field: 'id' };
  const guard = (operand: unknown) => ({ kind: 'call', function: 'nullIfZero', args: [operand] });
  return {
    name: 'averageOrderValue', kind: 'derived-metric',
    expression: { kind: 'binary', operator: 'divide', left: revenue, right: guard(orders) },
    derivation: {
      inputs: [
        { alias: 'revenue', expression: revenue },
        { alias: 'orders', expression: orders },
      ],
      expression: {
        kind: 'binary', operator: 'divide',
        left: { kind: 'reference', name: 'revenue' },
        right: guard({ kind: 'reference', name: 'orders' }),
      },
    },
    dimensions: [], filters: [], grains: [],
    endpoint: { access: { kind: 'public' }, tenant: { kind: 'not-required' } },
  };
}

describe('local dataset contract validation', () => {
  it('rejects hidden properties on local metric arrays', () => {
    const contract = dataset();
    Object.defineProperty(contract.metrics, 'hidden', { value: true });
    expect(() => validateProtocolDatasetContract(contract))
      .toThrow(/HQ_DEPLOYMENT_UNSAFE_OBJECT at \$\.metrics/);
  });

  it('preserves and freezes bounded semantic metadata', () => {
    const contract = validateProtocolDatasetContract({
      ...dataset(), description: 'Governed orders', examples: ['Revenue by region'],
      synonyms: ['purchases'], currency: 'USD', sensitivity: 'internal',
      timeField: 'createdAt',
      dimensions: [{
        name: 'createdAt', type: 'timestamp', source: { kind: 'column', column: 'created_at' },
        filterable: true, groupable: true,
      }],
      defaults: { dimensions: ['createdAt'], timeGrain: 'day' },
    });
    expect(contract.examples).toEqual(['Revenue by region']);
    expect(Object.isFrozen(contract.examples)).toBe(true);
    expect(Object.isFrozen(contract.defaults?.dimensions)).toBe(true);
  });

  it('rejects invalid or duplicate metadata', () => {
    expect(() => validateProtocolDatasetContract(
      { ...dataset(), description: '123456' }, { limits: { maxTextBytes: 5 } },
    )).toThrow(/HQ_DEPLOYMENT_TOO_LARGE.*description/);
    expect(() => validateProtocolDatasetContract({ ...dataset(), synonyms: ['orders', 'orders'] }))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VALUE.*synonyms/);
    expect(() => validateProtocolDatasetContract({ ...dataset(), currency: 'usd' }))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VALUE.*currency/);
  });

  it('preserves a derived metric formula and its authored alias order', () => {
    const contract = validateProtocolDatasetContract(dataset([derivedMetric()]));
    expect(contract.metrics[0].derivation?.inputs.map(input => input.alias))
      .toEqual(['revenue', 'orders']);
    expect(Object.isFrozen(contract.metrics[0].derivation?.inputs)).toBe(true);
  });

  it('rejects a derivation that disagrees with the metric expression', () => {
    const metric = derivedMetric();
    expect(() => validateProtocolDatasetContract(dataset([{
      ...metric,
      derivation: {
        ...metric.derivation,
        expression: {
          kind: 'binary', operator: 'divide',
          left: { kind: 'reference', name: 'orders' },
          right: { kind: 'reference', name: 'revenue' },
        },
      },
    }]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE.*derivation\.expression/);
  });

  it('rejects duplicate aliases and expressions that cannot be rebuilt', () => {
    const metric = derivedMetric();
    expect(() => validateProtocolDatasetContract(dataset([{
      ...metric,
      derivation: { ...metric.derivation, inputs: metric.derivation.inputs.map(input => ({
        ...input, alias: 'revenue',
      })) },
    }]))).toThrow(/HQ_DEPLOYMENT_INVALID_VALUE.*inputs\[1\]\.alias/);
    expect(() => validateProtocolDatasetContract(dataset([{
      ...metric,
      derivation: {
        ...metric.derivation,
        expression: { kind: 'call', function: 'round', args: [{ kind: 'reference', name: 'revenue' }] },
      },
    }]))).toThrow(/HQ_DEPLOYMENT_INVALID_VALUE.*derivation\.expression\.args/);
  });

  it('validates fixed grain against the declared supported grains', () => {
    const metric = {
      name: 'revenue', kind: 'grained-metric',
      expression: { kind: 'literal', value: 1 }, dimensions: [], filters: [],
      grains: ['day'], grain: 'month',
      endpoint: { access: { kind: 'public' }, tenant: { kind: 'not-required' } },
    };
    expect(() => validateProtocolDatasetContract(dataset([metric])))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VALUE.*grain/);
    expect(() => validateProtocolDatasetContract(dataset([{ ...metric, grain: 'day' }])))
      .not.toThrow();
  });
  it('validates and freezes composite relationship keys', () => {
    const input = { ...dataset(), relationships: [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_id', to: 'id', queryable: true, keys: [{ from: 'customer_id', to: 'id' }, { from: 'region', to: 'region' }] }] };
    const validated = validateProtocolDatasetContract(input);
    expect(validated.relationships[0].keys).toEqual(input.relationships[0].keys);
    expect(Object.isFrozen(validated.relationships[0].keys)).toBe(true);
    for (const keys of [[], [{ from: 'customer_id', to: 'id' }], [{ from: 'other', to: 'id' }, { from: 'region', to: 'region' }], [{ from: 'customer_id', to: 'id' }, { from: 'region', to: 'id' }], [{ from: 'customer_id', to: 'id' }, { from: 'bad;sql', to: 'region' }]]) {
      expect(() => validateProtocolDatasetContract({ ...input, relationships: [{ ...input.relationships[0], keys }] })).toThrow(/HQ_DEPLOYMENT/);
    }
  });

  it('bounds composite keys by maxDatasetItems', () => {
    const keys = [{ from: 'customer_id', to: 'id' }, { from: 'region', to: 'region' }, { from: 'shard', to: 'shard' }];
    const input = { ...dataset(), relationships: [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_id', to: 'id', queryable: true, keys }] };
    expect(() => validateProtocolDatasetContract(input, { limits: { maxDatasetItems: 2 } })).toThrow(/HQ_DEPLOYMENT_TOO_MANY_ITEMS/);
    expect(validateProtocolDatasetContract(input, { limits: { maxDatasetItems: 3 } }).relationships[0].keys).toHaveLength(3);
  });

  it('rejects qualified composite columns before rehydration while preserving legacy grammar', () => {
    const relationship = { name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_id', to: 'id', queryable: true };
    for (const field of ['from', 'to'] as const) {
      const first = { from: 'customer_id', to: 'id' };
      const second = { from: 'region', to: 'region' };
      for (const index of [0, 1]) {
        const keys = [{ ...first }, { ...second }];
        keys[index][field] = `orders.${keys[index][field]}`;
        const input = { ...dataset(), relationships: [{ ...relationship, ...keys[0], keys }] };
        expect(() => validateProtocolDatasetContract(input)).toThrow(/HQ_DEPLOYMENT_INVALID_IDENTIFIER/);
      }
    }
    const legacy = { ...dataset(), relationships: [{ ...relationship, from: 'orders.customer_id' }] };
    expect(validateProtocolDatasetContract(legacy).relationships[0].from).toBe('orders.customer_id');
  });

});
