import { describe, expect, it } from 'vitest';
import type { ProtocolDeploymentDataset } from '../deployments/index.js';
import {
  ProtocolFieldVisibilityError,
  resolveProtocolVisibleDatasetFields,
  validateProtocolFieldVisibility,
} from './index.js';

const dimension = (name: string) => ({
  name,
  type: 'string',
  source: { kind: 'column', column: name },
  filterable: true,
  groupable: true,
});

const shipments = {
  name: 'shipments',
  source: 'analytics.shipments',
  tenant: { kind: 'required', field: 'tenant_id' },
  timeField: 'shippedAt',
  dimensions: ['carrier', 'region', 'shippedAt', 'accountId'].map(dimension),
  measures: [
    { name: 'shipments', aggregation: 'count', field: 'carrier', filters: [] },
    { name: 'freightCost', aggregation: 'sum', field: 'carrier', filters: [] },
    {
      kind: 'derived',
      name: 'costPerShipment',
      uses: [
        { alias: 'cost', measure: 'freightCost' },
        { alias: 'count', measure: 'shipments' },
      ],
      expression: { kind: 'reference', name: 'cost' },
    },
  ],
  filters: [
    { name: 'region', field: 'region', operators: ['eq', 'in'] },
    { name: 'accountId', field: 'accountId', operators: ['eq'] },
    { name: 'customerSegment', field: 'customer.segment', operators: ['eq'] },
  ],
  relationships: [
    { name: 'customer', kind: 'belongsTo', target: 'customers', from: 'accountId', to: 'id', queryable: true },
  ],
} as unknown as ProtocolDeploymentDataset;

const customers = {
  name: 'customers',
  source: 'analytics.customers',
  tenant: { kind: 'required', field: 'tenant_id' },
  dimensions: ['id', 'segment', 'creditLimit'].map(dimension),
  measures: [],
  filters: [],
  relationships: [],
} as unknown as ProtocolDeploymentDataset;

const datasets = new Map([
  ['shipments', shipments],
  ['customers', customers],
]);

function visibility(entries: Record<string, unknown>) {
  return validateProtocolFieldVisibility({
    kind: 'hypequery-field-visibility',
    version: 1,
    datasets: entries,
  });
}

describe('field visibility', () => {
  it('normalizes a valid policy and freezes it', () => {
    const policy = visibility({
      shipments: { dimensions: ['region', 'carrier'], measures: '*' },
    });
    expect(policy.datasets.shipments).toEqual({ dimensions: ['carrier', 'region'], measures: '*' });
    expect(Object.isFrozen(policy.datasets.shipments)).toBe(true);
  });

  it.each([
    [{ kind: 'hypequery-field-visibility', version: 2, datasets: {} }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: {}, extra: true }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: { 'bad name': { dimensions: '*', measures: '*' } } }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: { a: { dimensions: '*' } } }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: { a: { dimensions: ['x', 'x'], measures: '*' } } }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: { a: { dimensions: 'all', measures: '*' } } }],
    [{ kind: 'hypequery-field-visibility', version: 1, datasets: { a: { dimensions: ['a.b'], measures: '*' } } }],
  ])('fails closed on a malformed policy', (input) => {
    expect(() => validateProtocolFieldVisibility(input)).toThrow(ProtocolFieldVisibilityError);
  });

  it('hides a dataset the policy does not name', () => {
    const policy = visibility({ customers: { dimensions: '*', measures: '*' } });
    expect(resolveProtocolVisibleDatasetFields(shipments, datasets, policy)).toBeNull();
  });

  it('exposes everything, including later fields, under *', () => {
    const policy = visibility({
      shipments: { dimensions: '*', measures: '*' },
      customers: { dimensions: '*', measures: '*' },
    });
    const visible = resolveProtocolVisibleDatasetFields(shipments, datasets, policy)!;
    expect([...visible.dimensions].sort()).toEqual([
      'accountId', 'carrier', 'customer.creditLimit', 'customer.id', 'customer.segment',
      'region', 'shippedAt',
    ]);
    expect([...visible.measures].sort()).toEqual(['costPerShipment', 'freightCost', 'shipments']);
    expect([...visible.filters].sort()).toEqual(['accountId', 'customerSegment', 'region']);
    expect(visible.timeField).toBe(true);
  });

  it('narrows dimensions, the filters over them, and the time field', () => {
    const policy = visibility({
      shipments: { dimensions: ['carrier', 'region', 'notAField'], measures: ['shipments'] },
    });
    const visible = resolveProtocolVisibleDatasetFields(shipments, datasets, policy)!;
    expect([...visible.dimensions].sort()).toEqual(['carrier', 'region']);
    expect([...visible.measures]).toEqual(['shipments']);
    expect([...visible.filters]).toEqual(['region']);
    expect(visible.timeField).toBe(false);
  });

  it('hides a derived measure whose inputs are hidden, even when listed', () => {
    const policy = visibility({
      shipments: { dimensions: '*', measures: ['shipments', 'costPerShipment'] },
    });
    const visible = resolveProtocolVisibleDatasetFields(shipments, datasets, policy)!;
    // costPerShipment x shipments would recover the hidden freightCost.
    expect([...visible.measures]).toEqual(['shipments']);
  });

  it('hides a time measure when the time field is hidden', () => {
    const withWindow = {
      ...shipments,
      measures: [
        ...shipments.measures,
        { kind: 'window', name: 'rollingShipments', measure: 'shipments' },
      ],
    } as unknown as ProtocolDeploymentDataset;
    const hiddenTime = visibility({
      shipments: { dimensions: ['carrier'], measures: '*' },
    });
    expect(resolveProtocolVisibleDatasetFields(withWindow, datasets, hiddenTime)!.measures.has('rollingShipments'))
      .toBe(false);
    const shownTime = visibility({
      shipments: { dimensions: ['carrier', 'shippedAt'], measures: '*' },
    });
    expect(resolveProtocolVisibleDatasetFields(withWindow, datasets, shownTime)!.measures.has('rollingShipments'))
      .toBe(true);
  });

  it('exposes a joined field only when the target dataset shows it', () => {
    const hiddenTarget = visibility({ shipments: { dimensions: '*', measures: '*' } });
    const hidden = resolveProtocolVisibleDatasetFields(shipments, datasets, hiddenTarget)!;
    expect([...hidden.dimensions].some(name => name.startsWith('customer.'))).toBe(false);
    expect(hidden.filters.has('customerSegment')).toBe(false);

    const partial = visibility({
      shipments: { dimensions: '*', measures: '*' },
      customers: { dimensions: ['segment'], measures: [] },
    });
    const visible = resolveProtocolVisibleDatasetFields(shipments, datasets, partial)!;
    expect(visible.dimensions.has('customer.segment')).toBe(true);
    expect(visible.dimensions.has('customer.creditLimit')).toBe(false);
    expect(visible.filters.has('customerSegment')).toBe(true);
  });

  it('is not fooled by prototype keys', () => {
    const policy = visibility({});
    const proto = { ...shipments, name: 'constructor' } as unknown as ProtocolDeploymentDataset;
    expect(resolveProtocolVisibleDatasetFields(proto, datasets, policy)).toBeNull();
  });
});
