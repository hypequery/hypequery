import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN,
  ProtocolDeploymentError,
  hashProtocolDeploymentContract,
  validateProtocolDeploymentContract,
  prepareProtocolDeploymentContract,
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

function deployment() {
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

describe('deployment contract v2', () => {
  it('validates and freezes base plus derived measures without metrics, queries, or artifacts', () => {
    const contract = validateProtocolDeploymentContract(deployment());
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
    expect(() => validateProtocolDeploymentContract({ ...deployment(), [field]: [] }))
      .toThrowError(ProtocolDeploymentError);
  });

  it('rejects dataset metrics, v1 uploads, and unknown fields', () => {
    const value = deployment();
    expect(() => validateProtocolDeploymentContract({
      ...value, datasets: [{ ...value.datasets[0], metrics: [] }],
    })).toThrow(/HQ_DEPLOYMENT_UNKNOWN_FIELD/);
    expect(() => validateProtocolDeploymentContract({ ...value, version: 1 }))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VERSION/);
    expect(() => validateProtocolDeploymentContract({ ...value, extra: true }))
      .toThrow(/HQ_DEPLOYMENT_UNKNOWN_FIELD/);
  });

  it('checks dataset references and defaults across the complete contract', () => {
    const value = deployment();
    const orders = value.datasets[0];
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...orders, relationships: [{
        name: 'customer', kind: 'belongsTo', target: 'missing',
        from: 'customerId', to: 'id', queryable: true,
      }] }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE.*relationships\[0\]\.target/);
    expect(() => validateProtocolDeploymentContract({
      ...value, datasets: [{ ...orders, defaults: { dimensions: ['missing'] } }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE.*defaults\.dimensions/);
    expect(() => validateProtocolDeploymentContract({
      ...value, datasets: [{ ...orders, defaults: { timeGrain: 'month' } }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE.*defaults\.timeGrain/);
  });

  it('requires endpoint and dataset tenant policies to agree', () => {
    const value = deployment();
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...value.datasets[0], endpoint: {
        access: { kind: 'public' }, tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      } }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE.*endpoint\.tenant/);
  });

  it('reports the index of a malformed measure', () => {
    const value = deployment();
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...value.datasets[0], measures: [baseMeasure('revenue', 'amount'), null] }],
    })).toThrow(/\$\.datasets\[0\]\.measures\[1\]/);
  });

  it('keeps a base measure index when derived measures precede it', () => {
    const value = deployment();
    const dataset = value.datasets[0];
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...dataset, measures: [
        baseMeasure('revenue', 'amount'),
        derivedMeasure(),
        { ...baseMeasure('orders', 'id'), field: 42 },
      ] }],
    })).toThrow(/\$\.datasets\[0\]\.measures\[2\]\.field/);
  });

  it('rejects missing dependencies, undeclared aliases, duplicate names, and nested derivation', () => {
    const value = deployment();
    const dataset = value.datasets[0];
    const derived = derivedMeasure();
    const replace = (measures: unknown[]) => ({ ...value, datasets: [{ ...dataset, measures }] });
    expect(() => validateProtocolDeploymentContract(replace([
      baseMeasure('revenue', 'amount'), { ...derived, uses: [{ alias: 'revenue', measure: 'missing' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDeploymentContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'),
      { ...derived, uses: [{ alias: 'wrong', measure: 'revenue' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDeploymentContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'),
      { ...derived, name: 'revenue' },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
    expect(() => validateProtocolDeploymentContract(replace([
      baseMeasure('revenue', 'amount'), baseMeasure('orders', 'id'), derived,
      { ...derived, name: 'second', uses: [{ alias: 'revenue', measure: 'averageOrderValue' }] },
    ]))).toThrow(/HQ_DEPLOYMENT_INVALID_REFERENCE/);
  });

  it('rejects expression kinds that cannot be rebuilt as a derived formula', () => {
    const value = deployment();
    const dataset = value.datasets[0];
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...dataset, measures: [
        ...dataset.measures.slice(0, 2),
        { ...derivedMeasure(), expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' } },
      ] }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_VALUE/);
    expect(() => validateProtocolDeploymentContract({
      ...value,
      datasets: [{ ...dataset, measures: [
        ...dataset.measures.slice(0, 2),
        { ...derivedMeasure(), uses: [{ alias: 'revenue', measure: 'revenue' }],
          expression: { kind: 'reference', name: 'revenue' } },
      ] }],
    })).toThrow(/HQ_DEPLOYMENT_INVALID_VALUE/);
  });

  it('rejects unsupported version 1 input', () => {
    expect(() => validateProtocolDeploymentContract({ ...deployment(), version: 1 }))
      .toThrow(/HQ_DEPLOYMENT_INVALID_VERSION/);
  });

  it('has deterministic v2 canonical bytes and a separate identity domain', () => {
    const first = prepareProtocolDeploymentContract(deployment());
    const second = prepareProtocolDeploymentContract(JSON.parse(JSON.stringify(deployment())));
    expect(first.canonical).toBe(second.canonical);
    expect(first.identity).toBe(hashProtocolDeploymentContract(deployment()));
    expect(first.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN).toBe('hypequery:deployment:v2\0');
    const fixture = JSON.parse(readFileSync(new URL(
      '../../../../specs/security-protocol/fixtures/deployments-v2/success.json',
      import.meta.url,
    ), 'utf8')) as [{ value: unknown }];
    const identity = JSON.parse(readFileSync(new URL(
      '../../../../specs/security-protocol/fixtures/deployments-v2/identity.json',
      import.meta.url,
    ), 'utf8')) as [{ canonical: string; sha256: string }];
    const prepared = prepareProtocolDeploymentContract(fixture[0].value);
    expect(prepared.canonical).toBe(identity[0].canonical);
    expect(prepared.identity).toBe(identity[0].sha256);
  });
});
