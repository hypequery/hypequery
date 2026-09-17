import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_DATASET_ONLY_IDENTITY_DOMAIN,
  ProtocolDeploymentError,
  hashProtocolDatasetOnlyContract,
  prepareProtocolDatasetOnlyContract,
  projectLegacyProtocolDeploymentContract,
  validateProtocolDatasetOnlyContract,
  validateProtocolDeploymentContract,
} from './index.js';

function baseMeasure(name: string, field: string) {
  return { name, aggregation: 'sum', field, filters: [] };
}

function derivedMeasure() {
  return {
    kind: 'derived',
    name: 'averageOrderValue',
    uses: [
      { alias: 'revenue', measure: 'revenue' },
      { alias: 'orders', measure: 'orders' },
    ],
    expression: {
      kind: 'binary', operator: 'divide',
      left: { kind: 'reference', name: 'revenue' },
      right: { kind: 'call', function: 'nullIfZero', args: [
        { kind: 'reference', name: 'orders' },
      ] },
    },
    label: 'Average order value',
  };
}

function datasetOnly() {
  return {
    kind: 'hypequery-deployment', version: 2,
    datasets: [{
      name: 'orders', source: 'orders', tenant: { kind: 'not-required' },
      dimensions: [],
      measures: [baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'), derivedMeasure()],
      filters: [], relationships: [],
    }],
  };
}

describe('dataset-only deployment contract v2', () => {
  it('validates and freezes base plus derived measures without metrics, queries, or artifacts', () => {
    const contract = validateProtocolDatasetOnlyContract(datasetOnly());
    expect(contract.version).toBe(2);
    expect(contract.datasets[0].measures.map(measure => measure.name))
      .toEqual(['revenue', 'orders', 'averageOrderValue']);
    expect(contract.datasets[0]).not.toHaveProperty('metrics');
    expect(contract).not.toHaveProperty('queries');
    expect(contract).not.toHaveProperty('artifacts');
    expect(Object.isFrozen(contract.datasets[0].measures)).toBe(true);
    expect(Object.isFrozen(contract.datasets[0].measures[2])).toBe(true);
  });

  it.each(['queries', 'artifacts'])('rejects %s even when empty', field => {
    expect(() => validateProtocolDatasetOnlyContract({ ...datasetOnly(), [field]: [] }))
      .toThrowError(ProtocolDeploymentError);
  });

  it('rejects dataset metrics, v1 uploads, and unknown fields', () => {
    const value = datasetOnly();
    expect(() => validateProtocolDatasetOnlyContract({
      ...value, datasets: [{ ...value.datasets[0], metrics: [] }],
    })).toThrow(/HQ_DEPLOYMENT_UNKNOWN_FIELD/);
    expect(() => validateProtocolDatasetOnlyContract({ ...value, version: 1 }))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VERSION/);
    expect(() => validateProtocolDatasetOnlyContract({ ...value, extra: true }))
      .toThrow(/HQ_DEPLOYMENT_UNKNOWN_FIELD/);
  });

  it('reports the index of a malformed measure', () => {
    const value = datasetOnly();
    expect(() => validateProtocolDatasetOnlyContract({
      ...value,
      datasets: [{ ...value.datasets[0], measures: [baseMeasure('revenue', 'amount'), null] }],
    })).toThrow(/\$\.datasets\[0\]\.measures\[1\]/);
  });

  it('keeps a base measure index when derived measures precede it', () => {
    const value = datasetOnly();
    const dataset = value.datasets[0];
    expect(() => validateProtocolDatasetOnlyContract({
      ...value,
      datasets: [{ ...dataset, measures: [
        baseMeasure('revenue', 'amount'),
        derivedMeasure(),
        { ...baseMeasure('orders', 'id'), field: 42 },
      ] }],
    })).toThrow(/\$\.datasets\[0\]\.measures\[2\]\.field/);
  });

  it('rejects missing dependencies, undeclared aliases, duplicate names, and nested derivation', () => {
    const value = datasetOnly();
    const dataset = value.datasets[0];
    const derived = derivedMeasure();
    const replace = (measures: unknown[]) => ({ ...value, datasets: [{ ...dataset, measures }] });
    expect(() => validateProtocolDatasetOnlyContract(replace([
      baseMeasure('revenue', 'amount'), { ...derived, uses: [{ alias: 'revenue', measure: 'missing' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDatasetOnlyContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'),
      { ...derived, uses: [{ alias: 'wrong', measure: 'revenue' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDatasetOnlyContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'),
      { ...derived, name: 'revenue' },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDatasetOnlyContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'), derived,
      { ...derived, name: 'second', uses: [{ alias: 'revenue', measure: 'averageOrderValue' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
  });

  it('rejects expression kinds that cannot be rebuilt as a derived formula', () => {
    const value = datasetOnly();
    const dataset = value.datasets[0];
    expect(() => validateProtocolDatasetOnlyContract({
      ...value,
      datasets: [{ ...dataset, measures: [
        ...dataset.measures.slice(0, 2),
        { ...derivedMeasure(), expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' } },
      ] }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_VALUE/);
  });

  it('projects stored v1 releases to datasets without accepting them as new uploads', () => {
    const v1 = validateProtocolDeploymentContract({
      kind: 'hypequery-deployment', version: 1,
      datasets: [{ ...datasetOnly().datasets[0], measures: [baseMeasure('revenue', 'amount')], metrics: [] }],
      queries: [], artifacts: [],
    });
    const projected = projectLegacyProtocolDeploymentContract(v1);
    expect(projected.version).toBe(2);
    expect(projected.datasets[0].measures).toHaveLength(1);
    expect(projected).not.toHaveProperty('queries');
    expect(projected.datasets[0]).not.toHaveProperty('metrics');
    expect(() => validateProtocolDatasetOnlyContract(v1)).toThrow(/HQ_DEPLOYMENT_UNKNOWN_FIELD|HQ_DEPLOYMENT_INVALID_VERSION/);
  });

  it('has deterministic v2 canonical bytes and a separate identity domain', () => {
    const first = prepareProtocolDatasetOnlyContract(datasetOnly());
    const second = prepareProtocolDatasetOnlyContract(JSON.parse(JSON.stringify(datasetOnly())));
    expect(first.canonical).toBe(second.canonical);
    expect(first.identity).toBe(hashProtocolDatasetOnlyContract(datasetOnly()));
    expect(first.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(PROTOCOL_DATASET_ONLY_IDENTITY_DOMAIN).toBe('hypequery:deployment:v2\0');
  });
});
