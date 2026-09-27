/** Local dataset-contract metric exclusions. Cloud deployments carry no metrics. */
import { validateProtocolDatasetContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import {
  rehydrateProtocolDatasets,
  UNSUPPORTED_CONTRACT_REASONS,
  UnsupportedContractFeatureError,
  type UnsupportedContractReason,
} from './protocol-rehydrate.js';
import { Buyers, LineItems, Products, marketplaceMetrics } from './tests/support/corpus-schemas/marketplace.js';

const PUBLIC_ENDPOINT = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
const metrics = Object.fromEntries(Object.keys(marketplaceMetrics).map(name => [name, PUBLIC_ENDPOINT]));
const contracts = [
  ...[Buyers, Products].map(item => buildProtocolDatasetContract(item, { endpoint: PUBLIC_ENDPOINT })),
  buildProtocolDatasetContract(LineItems, {
    endpoint: PUBLIC_ENDPOINT,
    metrics: marketplaceMetrics,
    metricEndpoints: metrics,
  }),
];
const lineItems = contracts[contracts.length - 1]!;

function withLineItems(patch: (contract: typeof lineItems) => unknown) {
  return [...contracts.slice(0, -1), patch(structuredClone(lineItems))] as never;
}

function metricNamed(contract: typeof lineItems, name: string) {
  return contract.metrics.find(metric => String(metric.name) === name)!;
}

const exclusions: ReadonlyArray<{
  readonly reason: UnsupportedContractReason;
  readonly scenario: string;
  readonly validLocalContract: boolean;
  readonly contracts: () => never;
}> = [
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.expressionNotAggregate,
    scenario: 'derived metric input is a reference',
    validLocalContract: false,
    contracts: () => withLineItems(contract => {
      const aov = metricNamed(contract, 'averageOrderValue');
      (aov.derivation!.inputs[0] as { expression: unknown }).expression = { kind: 'reference', name: 'gmv' };
      return contract;
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.noMatchingMeasure,
    scenario: 'metric has no matching measure',
    validLocalContract: true,
    contracts: () => withLineItems(contract => ({
      ...contract,
      measures: contract.measures.filter(item => String(item.name) !== 'gmv'),
      metrics: contract.metrics.filter(metric => String(metric.name) === 'gmv'),
    })),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.ambiguousMeasureSql,
    scenario: 'two matching measures emit different SQL',
    validLocalContract: false,
    contracts: () => withLineItems(contract => {
      const units = contract.measures.find(item => String(item.name) === 'units')!;
      return {
        ...contract,
        measures: [...contract.measures, { ...units, name: 'unitsNet', sql: { sql: 'sum(quantity) - 1', dependencies: ['quantity'] } }],
        metrics: [{ ...metricNamed(contract, 'gmv'), name: 'units', expression: { kind: 'aggregate', aggregation: 'sum', field: 'quantity' } }],
      };
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.derivedMetricWithoutFormula,
    scenario: 'older metric contract has no authored formula',
    validLocalContract: true,
    contracts: () => withLineItems(contract => {
      const { derivation: _derivation, ...aov } = metricNamed(contract, 'averageOrderValue');
      return { ...contract, metrics: [aov] };
    }),
  },
  {
    reason: UNSUPPORTED_CONTRACT_REASONS.unsupportedFormula,
    scenario: 'metric formula uses an unsupported function',
    validLocalContract: false,
    contracts: () => withLineItems(contract => {
      const rate = metricNamed(contract, 'discountRate');
      (rate.derivation as { expression: unknown }).expression = {
        kind: 'call', function: 'log', args: [{ kind: 'reference', name: 'gmv' }],
      };
      return { ...contract, metrics: [rate] };
    }),
  },
];

describe('local protocol metric exclusions', () => {
  it.each(exclusions)('$reason: $scenario', ({ reason, validLocalContract, contracts: fixture }) => {
    const snapshots = fixture();
    const validate = () => validateProtocolDatasetContract(snapshots[snapshots.length - 1]);
    if (validLocalContract) expect(validate).not.toThrow();
    else expect(validate).toThrow();

    expect(() => rehydrateProtocolDatasets(snapshots)).toThrowError(UnsupportedContractFeatureError);
    try {
      rehydrateProtocolDatasets(snapshots);
    } catch (error) {
      expect((error as UnsupportedContractFeatureError).reason).toBe(reason);
    }
  });
});
