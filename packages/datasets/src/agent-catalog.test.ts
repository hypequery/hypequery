import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { projectAgentSafeCatalog, projectTrustedDebugCatalog } from './agent-catalog.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../specs/deployment/fixtures/mcp-cloud-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('agent-safe catalog projection', () => {
  it('matches the shared deployment fixture', () => {
    const deployment = validateProtocolDeploymentContract(fixture('deployment.json'));

    expect(projectAgentSafeCatalog(deployment))
      .toEqual(fixture('expected-safe-catalog.json'));
  });

  it('excludes physical and tenant metadata from local datasets', () => {
    const Orders = dataset('orders', {
      source: 'analytics.private_orders',
      tenantKey: 'tenant_secret',
      timeKey: 'createdAt',
      dimensions: {
        createdAt: dimension.timestamp({ column: 'created_at' }),
        region: dimension.string({
          sql: 'upper(private_region_sql)',
          dependencies: ['private_region_sql'],
        }),
        internalAmount: dimension.number({
          column: 'amount_cents',
          filterable: false,
          groupable: false,
        }),
      },
      measures: {
        revenue: measure.sum('internalAmount', {
          sql: 'internalAmount * 1.2',
          dependencies: ['internalAmount'],
          label: 'Revenue',
        }),
      },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

    const catalog = projectAgentSafeCatalog({
      orders: { ...Orders, metrics: { totalRevenue } },
    });
    const serialized = JSON.stringify(catalog);

    expect(catalog.datasets[0]).toMatchObject({
      name: 'orders',
      timeDimension: 'createdAt',
      dimensions: [
        { name: 'createdAt' },
        { name: 'region' },
      ],
      measures: [{ name: 'revenue', label: 'Revenue' }],
      metrics: [{ name: 'totalRevenue' }],
    });
    for (const forbidden of [
      'analytics.private_orders',
      'tenant_secret',
      'created_at',
      'private_region_sql',
      'amount_cents',
      'internalAmount',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps physical metadata behind explicit trusted-debug authorization', () => {
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.number({ column: 'order_id' }) },
    });

    expect(() => projectTrustedDebugCatalog(
      { orders: Orders },
      {} as { authorized: true },
    )).toThrow('requires explicit authorization');

    const debug = projectTrustedDebugCatalog(
      { orders: Orders },
      { authorized: true },
    );
    expect(debug).toMatchObject({
      kind: 'dataset-catalog',
      datasets: {
        orders: {
          source: 'analytics.orders',
          tenantKey: 'tenant_id',
          dimensions: { id: { column: 'order_id' } },
        },
      },
    });
  });
});
