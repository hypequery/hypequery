import { describe, expect, it } from 'vitest';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { serializeSemanticContract } from './contract.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';

const publicEndpoint = {
  access: { kind: 'public' as const },
  tenant: { kind: 'not-required' as const },
};

describe('agent-oriented semantic metadata', () => {
  const Orders = dataset('orders', {
    source: 'orders',
    description: 'Governed order analytics.',
    examples: ['Revenue by region', 'Weekly order volume'],
    synonyms: ['purchases', 'sales orders'],
    timezone: 'Europe/Madrid',
    freshness: { maxAgeSeconds: 300 },
    owner: 'analytics@example.com',
    sensitivity: 'internal',
    defaults: { dimensions: ['region'], timeGrain: 'week' },
    timeKey: 'createdAt',
    dimensions: {
      createdAt: dimension.timestamp({
        label: 'Created at',
        format: 'date-time',
        timezone: 'UTC',
      }),
      region: dimension.string({
        examples: ['EMEA', 'NA'],
        synonyms: ['market'],
      }),
      amount: dimension.number({ filterable: false, groupable: false }),
    },
    measures: {
      revenue: measure.sum('amount', {
        format: 'currency',
        unit: 'dollars',
        currency: 'USD',
        sensitivity: 'confidential',
      }),
    },
  });
  const totalRevenue = Orders.metric('totalRevenue', {
    measure: 'revenue',
    examples: ['Total revenue this week'],
    synonyms: ['sales'],
    format: 'currency',
    currency: 'USD',
  });
  const registry = { orders: { ...Orders, metrics: { totalRevenue } } };

  it('round-trips metadata through catalog, semantic contract, and protocol', () => {
    const semanticContract = serializeSemanticContract(registry);
    const protocolContract = buildProtocolDatasetContract(Orders, {
      endpoint: publicEndpoint,
      metrics: { totalRevenue },
      metricEndpoints: { totalRevenue: publicEndpoint },
    });
    const local = projectAgentSafeCatalog(registry).datasets[0];
    const fromSemanticContract = projectAgentSafeCatalog(semanticContract).datasets[0];
    const fromProtocol = projectAgentSafeCatalog({
      kind: 'hypequery-deployment',
      version: 1,
      datasets: [protocolContract],
      queries: [],
      artifacts: [],
    }).datasets[0];

    for (const projected of [local, fromSemanticContract, fromProtocol]) {
      expect(projected).toMatchObject({
        name: 'orders',
        description: 'Governed order analytics.',
        examples: ['Revenue by region', 'Weekly order volume'],
        synonyms: ['purchases', 'sales orders'],
        timezone: 'Europe/Madrid',
        freshness: { maxAgeSeconds: 300 },
        owner: 'analytics@example.com',
        sensitivity: 'internal',
        defaults: { dimensions: ['region'], timeGrain: 'week' },
        dimensions: expect.arrayContaining([
          expect.objectContaining({ name: 'region', examples: ['EMEA', 'NA'], synonyms: ['market'] }),
        ]),
        measures: [expect.objectContaining({
          name: 'revenue', format: 'currency', unit: 'dollars', currency: 'USD',
        })],
        metrics: [expect.objectContaining({
          name: 'totalRevenue', examples: ['Total revenue this week'], currency: 'USD',
        })],
      });
    }
  });

  it('enforces the configured catalog byte budget', () => {
    expect(() => projectAgentSafeCatalog(registry, { maxCatalogBytes: 32 }))
      .toThrow('Agent-safe catalog exceeds the 32-byte limit');
    expect(() => projectAgentSafeCatalog(registry, { maxCatalogBytes: 0 }))
      .toThrow('maxCatalogBytes must be a positive safe integer');
  });

  it('rejects invalid metadata when the dataset or metric is defined', () => {
    expect(() => dataset('invalid_currency', {
      source: 'orders',
      currency: 'usd',
      dimensions: { id: dimension.number() },
    })).toThrow('currency');

    expect(() => Orders.metric('badMetric', {
      measure: 'revenue',
      synonyms: ['sales', 'sales'],
    })).toThrow('must not contain duplicates');
  });
});
