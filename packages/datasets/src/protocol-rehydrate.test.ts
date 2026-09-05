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

  it('binds a metric to the measure it was built from, not a lookalike', () => {
    // `revenue` and `paidRevenue` are both sum(amount) and differ only by a
    // fixed filter. Contract measures arrive sorted by name, so matching on
    // aggregation and field alone binds totalRevenue to `paidRevenue` and
    // silently changes the SQL the metric emits.
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      dimensions: {
        status: dimension.string(),
        amount: dimension.number({ column: 'amount_cents' }),
      },
      measures: {
        revenue: measure.sum('amount'),
        paidRevenue: measure.sum('amount', { filters: [eq('status', 'paid')] }),
      },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
    const contract = buildProtocolDatasetContract(Orders as never, {
      endpoint: PUBLIC_ENDPOINT as never,
      metrics: { totalRevenue } as never,
      metricEndpoints: { totalRevenue: PUBLIC_ENDPOINT } as never,
    });

    const registry = rehydrateProtocolDatasets([contract]);

    expect(roundTrip(contract, registry as never)).toEqual(contract);
    // The distinguishing property is the fixed filter, not the field: binding
    // to `paidRevenue` would carry `status = 'paid'` into every use of the
    // metric. Both measures share aggregation and field.
    const spec = (registry.orders.metrics.totalRevenue as unknown as {
      spec: { field: string; filters?: unknown[] };
    }).spec;
    expect(spec.field).toBe('amount');
    expect(spec.filters ?? []).toEqual([]);
  });

  it('fails closed when two measures are indistinguishable in the contract', () => {
    // Both are sum(amount) with no filters, but one overrides the SQL. A metric
    // expression carries no SQL, so the contract cannot say which one the
    // metric was built from — guessing would silently pick one of two results.
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      dimensions: { amount: dimension.number({ column: 'amount_cents' }) },
      measures: {
        revenue: measure.sum('amount'),
        rawRevenue: measure.sum('amount', {
          sql: 'sum(amount_cents) / 100',
          dependencies: ['amount_cents'],
        }),
      },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
    const contract = buildProtocolDatasetContract(Orders as never, {
      endpoint: PUBLIC_ENDPOINT as never,
      metrics: { totalRevenue } as never,
      metricEndpoints: { totalRevenue: PUBLIC_ENDPOINT } as never,
    });

    expect(() => rehydrateProtocolDatasets([contract]))
      .toThrow(/emit different SQL/);
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
