import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { getDatasetCatalog } from './catalog.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import {
  rehydrateProtocolDatasets,
  UnsupportedContractFeatureError,
} from './protocol-rehydrate.js';
import { belongsTo } from './relationships.js';
import { eq } from './query-helpers.js';

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../specs/deployment/fixtures/mcp-cloud-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const PUBLIC_ENDPOINT = {
  access: { kind: 'public' },
  tenant: { kind: 'not-required' },
} as const;

/** contract -> catalog -> contract, the identity CORE-15 must preserve. */
function roundTrip(
  contract: ReturnType<typeof validateProtocolDeploymentContract>['datasets'][number],
  registry: Record<string, { metrics: Record<string, unknown> }>,
) {
  return buildProtocolDatasetContract(registry[contract.name] as never, {
    endpoint: contract.endpoint,
    metrics: registry[contract.name].metrics as never,
    metricEndpoints: Object.fromEntries(
      contract.metrics.map(metric => [metric.name, metric.endpoint]),
    ),
  });
}

describe('contract-to-catalog rehydration', () => {
  const deployment = validateProtocolDeploymentContract(fixture('deployment.json'));

  it('round-trips the vertical-slice fixture to an identical contract', () => {
    const registry = rehydrateProtocolDatasets(deployment.datasets);

    for (const contract of deployment.datasets) {
      expect(roundTrip(contract, registry as never)).toEqual(contract);
    }
  });

  it('projects the same agent-safe catalog as the contract it was rebuilt from', () => {
    const registry = rehydrateProtocolDatasets(deployment.datasets);

    expect(projectAgentSafeCatalog(registry))
      .toEqual(projectAgentSafeCatalog(deployment));
    expect(projectAgentSafeCatalog(registry))
      .toEqual(fixture('expected-safe-catalog.json'));
  });

  it('restores the physical mappings execution needs', () => {
    const registry = rehydrateProtocolDatasets(deployment.datasets);
    const catalog = getDatasetCatalog(registry.orders);

    // The whole point of decision 0005: no customer module is loaded, so the
    // contract alone has to carry everything the planner reads.
    expect(catalog.source).toBe('analytics.orders');
    expect(catalog.tenantKey).toBe('tenant_id');
    expect(catalog.timeKey).toBe('createdAt');
    expect(catalog.dimensions.createdAt.column).toBe('created_at');
    expect(catalog.dimensions.orderId.column).toBe('order_id');
    expect(catalog.limits).toEqual({
      maxDimensions: 4, maxMeasures: 2, maxFilters: 3, maxResultSize: 100,
    });
  });

  it('keeps a metric to the capabilities the contract declared', () => {
    const registry = rehydrateProtocolDatasets(deployment.datasets);
    const contract = registry.orders.metrics.totalRevenue.contract();

    // `dataset.metric()` would derive these from every dimension. The contract
    // published three, and widening them would offer an agent a dimension the
    // deployment never exposed.
    expect(contract.dimensions).toEqual(['createdAt', 'region', 'status']);
    expect(contract.filters).toEqual(['createdAt', 'region', 'status']);
  });

  it('round-trips an authored dataset through the contract unchanged', () => {
    // Broader than the fixture: SQL-backed dimensions, a filtered measure,
    // argMax, percentile, a relationship, and explicit operator lists.
    const Customers = dataset('customers', {
      source: 'analytics.customers',
      dimensions: {
        id: dimension.number({ column: 'customer_id' }),
        country: dimension.string({ column: 'country_code', label: 'Country' }),
      },
    });
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      timeKey: 'createdAt',
      dimensions: {
        createdAt: dimension.timestamp({ column: 'created_at' }),
        customerId: dimension.number({ column: 'customer_id' }),
        status: dimension.string({ description: 'Order status.' }),
        region: dimension.string({
          sql: 'upper(region_code)',
          dependencies: ['region_code'],
          filterable: false,
        }),
        amount: dimension.number({ column: 'amount_cents', groupable: false }),
      },
      measures: {
        revenue: measure.sum('amount', { label: 'Revenue' }),
        paidRevenue: measure.sum('amount', { filters: [eq('status', 'paid')] }),
        topRegion: measure.argMax('region', 'amount'),
        p95: measure.percentile('amount', 0.95),
      },
      filters: {
        status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
      },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
      },
      limits: { maxDimensions: 3, maxResultSize: 500 },
    });

    const contracts = [Customers, Orders].map(instance => buildProtocolDatasetContract(
      instance as never,
      { endpoint: PUBLIC_ENDPOINT as never },
    ));
    const registry = rehydrateProtocolDatasets(contracts);

    for (const contract of contracts) {
      expect(roundTrip(contract, registry as never)).toEqual(contract);
    }
  });

  it('rewires a relationship onto the rebuilt target', () => {
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: { id: dimension.number(), country: dimension.string() },
    });
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.number(), customerId: dimension.number() },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
      },
    });
    const contracts = [Orders, Customers].map(instance => buildProtocolDatasetContract(
      instance as never,
      { endpoint: PUBLIC_ENDPOINT as never },
    ));

    const registry = rehydrateProtocolDatasets(contracts);
    const target = registry.orders.relationships.customer.target();

    // Resolved against the rebuilt registry, not the authored instances — and
    // declared before its target, so resolution cannot depend on build order.
    expect(target).toBe(registry.customers);
    expect(getDatasetCatalog(registry.orders).relationships.customer.fields)
      .toEqual(['customer.country', 'customer.id']);
  });

  it('fails closed on a derived metric until its expression is carried', () => {
    const derived = {
      ...deployment.datasets[0],
      metrics: [{ ...deployment.datasets[0].metrics[0], kind: 'derived-metric' as const }],
    };

    expect(() => rehydrateProtocolDatasets([derived]))
      .toThrow(UnsupportedContractFeatureError);
    expect(() => rehydrateProtocolDatasets([derived]))
      .toThrow(/does not carry/);
  });

  it('fails closed on a metric with no matching measure', () => {
    const orphaned = {
      ...deployment.datasets[0],
      metrics: [{
        ...deployment.datasets[0].metrics[0],
        expression: { kind: 'aggregate' as const, aggregation: 'avg' as const, field: 'amount' },
      }],
    };

    expect(() => rehydrateProtocolDatasets([orphaned]))
      .toThrow(/no declared measure matches avg\(amount\)/);
  });

  it('fails closed on a relationship target outside the supplied contract', () => {
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: { id: dimension.number() },
    });
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.number(), customerId: dimension.number() },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
      },
    });
    const [orders] = [Orders].map(instance => buildProtocolDatasetContract(
      instance as never,
      { endpoint: PUBLIC_ENDPOINT as never },
    ));

    const registry = rehydrateProtocolDatasets([orders]);
    expect(() => registry.orders.relationships.customer.target())
      .toThrow(/is not part of the supplied contract/);
  });
});
