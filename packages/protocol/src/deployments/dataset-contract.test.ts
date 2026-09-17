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
});
