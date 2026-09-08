import { buildMetricPlan } from './semantic-planner.js';
import { createDatasetClient } from './executor.js';
import type { MetricRef, MetricQuery } from './types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { getDatasetCatalog } from './catalog.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { divide, nullIfZero, round } from './formulas.js';
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

/** Renders each builder call into readable SQL so a plan can be asserted on. */
function renderingBuilder() {
  const build = (table: string) => {
    const select: string[] = [];
    const where: string[] = [];
    const groupBy: string[] = [];
    const agg = (fn: string) => (column: string, alias?: string) => {
      select.push(`${fn}(${column}) AS ${alias ?? column}`);
      return builder;
    };
    const builder: Record<string, unknown> = {
      select: (columns: string | string[]) => {
        select.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      sum: agg('SUM'),
      count: agg('COUNT'),
      groupBy: (columns: string | string[]) => {
        groupBy.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      where: (column: string, operator: string, value: unknown) => {
        where.push(`${column} ${operator} ${JSON.stringify(value)}`);
        return builder;
      },
      toSQLWithParams: () => ({
        sql: `SELECT ${select.join(', ')} FROM ${table}`
          + (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '')
          + (groupBy.length > 0 ? ` GROUP BY ${groupBy.join(', ')}` : ''),
        parameters: [],
      }),
    };
    return new Proxy(builder, {
      get: (target, property: string) => target[property] ?? (() => builder),
    });
  };
  return { table: build, rawQuery: async () => [] };
}

/**
 * A dataset carrying a derived metric, authored rather than hand-written, so
 * the contract under test is the one the adapter actually emits.
 */
function derivedContract() {
  const Orders = dataset('orders', {
    source: 'analytics.orders',
    dimensions: {
      status: dimension.string(),
      amount: dimension.number({ column: 'amount_cents', groupable: false }),
    },
    measures: {
      revenue: measure.sum('amount'),
      orders: measure.count('status'),
    },
  });
  const averageOrderValue = Orders.metric('averageOrderValue', {
    uses: {
      revenue: Orders.metric('revenue', { measure: 'revenue' }),
      orders: Orders.metric('orders', { measure: 'orders' }),
    },
    formula: ({ revenue, orders }) => round(divide(revenue, nullIfZero(orders)), 2),
  });
  return buildProtocolDatasetContract(Orders as never, {
    endpoint: PUBLIC_ENDPOINT as never,
    metrics: { averageOrderValue } as never,
    metricEndpoints: { averageOrderValue: PUBLIC_ENDPOINT as never },
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

  it('preserves semantic metadata at every contract level', () => {
    const metadata = { examples: ['example'], synonyms: ['alias'], format: 'currency', unit: 'USD', currency: 'USD', timezone: 'UTC', sensitivity: 'internal' as const };
    const source = deployment.datasets.find(item => item.name === 'orders')!;
    const contract = {
      ...source, ...metadata, description: 'Order analytics', owner: 'Finance',
      freshness: { maxAgeSeconds: 300 }, defaults: { dimensions: ['status', 'region'] as typeof source.dimensions[number]['name'][] },
      dimensions: source.dimensions.map(item => ({ ...item, ...metadata })),
      measures: source.measures.map(item => ({ ...item, ...metadata })),
      filters: source.filters.map(item => ({ ...item, ...metadata })),
      metrics: source.metrics.map(item => ({ ...item, ...metadata })),
    };
    const registry = rehydrateProtocolDatasets([contract, ...deployment.datasets.filter(item => item.name !== source.name)]);
    expect(roundTrip(contract, registry as never)).toEqual(contract);
  });

  it('plans the fixture\'s derived metric under the aliases it declared', () => {
    const registry = rehydrateProtocolDatasets(deployment.datasets);
    const client = createDatasetClient({ queryBuilder: renderingBuilder() });

    const sql = client.toSQL(
      registry.orders.metrics.averageOrderValue as never,
      { dimensions: ['region'] } as never,
      { runtime: { tenant: 'tenant_acme' } } as never,
    );

    // The formula, written in the aliases the contract carried, over an
    // intermediate aggregate whose columns are those same aliases. Nothing here
    // came from a customer module.
    expect(sql).toContain('(revenue) / (NULLIF(orders, 0)) AS averageOrderValue');
    expect(sql).toContain('SUM(amount) AS revenue');
    expect(sql).toContain('COUNT(order_id) AS orders');
    expect(sql).toContain('analytics.orders');
    expect(sql).toContain('tenant_acme');
  });

  it('keeps a derived metric\'s formula out of the agent-safe catalog', () => {
    const [orders] = projectAgentSafeCatalog(deployment).datasets;
    const metric = orders.metrics.find(entry => entry.name === 'averageOrderValue');

    // The formula names measure input fields and aggregations, which the safe
    // projection exists to withhold. An agent is told the metric exists and
    // what it can be grouped, filtered, and grained by — not how it is computed.
    expect(metric).toBeDefined();
    expect(JSON.stringify(metric)).not.toContain('derivation');
    expect(JSON.stringify(metric)).not.toContain('amount');
    expect(JSON.stringify(metric)).not.toContain('aggregate');
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

  it('enforces published capabilities before planning or executing, including after by()', async () => {
    const contract = deployment.datasets.find(item => item.name === 'orders')!;
    const original = contract.metrics.find(item => item.name === 'totalRevenue')!;
    const narrowed = { ...original, grain: undefined, kind: 'metric' as const, dimensions: ['status'], filters: ['status'], grains: ['day'] as const };
    const registry = rehydrateProtocolDatasets([{ ...contract, metrics: [narrowed] }]);
    const metric = registry.orders.metrics.totalRevenue as MetricRef;
    const client = createDatasetClient({ queryBuilder: { from() { throw new Error('Must reject before builder'); } } as never });
    expect(metric.by('day').metric).toBe(metric);
    expect(metric.by('day').contract().dimensions).toEqual(['status']);
    expect(() => metric.by('month')).toThrow('not published');
    const queries: MetricQuery[] = [
      { dimensions: ['region'] },
      { filters: [eq('region', 'EU')] },
      { by: 'month' },
    ];
    for (const query of queries) {
      expect(client.validate(metric, query).errors.join('; ')).toContain('not published');
      expect(() => client.toSQL(metric, query)).toThrow('not published');
      await expect(client.execute(metric, query)).rejects.toThrow('not published');
      expect(() => buildMetricPlan(metric, query)).toThrow('not published');
    }
    expect(() => client.toSQL(metric.by('day'), { dimensions: ['region'] })).toThrow('not published');
    const catalog = metric.contract();
    catalog.dimensions.push('region');
    expect(() => buildMetricPlan(metric, { dimensions: ['region'] })).toThrow('not published');
    expect(buildMetricPlan(metric, { dimensions: ['status'] }, { runtime: { tenant: 'acme' } })).toMatchObject({ kind: 'aggregate' });
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

  it('round-trips a derived metric through its authored formula', () => {
    const contract = derivedContract();

    const registry = rehydrateProtocolDatasets([contract]);

    expect(roundTrip(contract, registry as never)).toEqual(contract);
  });

  it('fails closed on a derived metric whose formula the contract does not carry', () => {
    // A contract written before `derivation` existed. Its inlined expression
    // states what the metric means but not the aliases its SQL is written in
    // terms of, so a rebuild would compute the same number through different
    // SQL — which decision 0005 excludes rather than accepts.
    const { derivation, ...metric } = derivedContract().metrics[0];
    const stripped = { ...derivedContract(), metrics: [metric] };

    expect(derivation).toBeDefined();
    expect(() => rehydrateProtocolDatasets([stripped as never]))
      .toThrow(UnsupportedContractFeatureError);
    expect(() => rehydrateProtocolDatasets([stripped as never]))
      .toThrow(/requires its authored formula/);
  });

  it('fails closed on a metric with no matching measure', () => {
    // Selected by name, not position: the fixture's metric list is ordered and
    // may grow, and an index would quietly retarget this at another metric.
    const source = deployment.datasets.find(item => item.name === 'orders')!;
    const base = source.metrics.find(item => item.name === 'totalRevenue')!;
    const orphaned = {
      ...source,
      metrics: [{
        ...base,
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
