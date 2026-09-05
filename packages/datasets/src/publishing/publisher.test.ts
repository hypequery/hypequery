import { describe, expect, it, vi } from 'vitest';
import { projectAgentSafeCatalog } from '../agent-catalog.js';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';
import { getDatasetCatalog } from '../catalog.js';
import { buildCanonicalSemanticQuerySchemas } from '../semantic-query-schema.js';
import { belongsTo } from '../relationships.js';
import { generateDatasetTools } from '../tools.js';
import type { MetricHandle } from '../types.js';
import { createDatasetPublisher } from './publisher.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string() },
  measures: { count: measure.count('id') },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const monthlyRevenue = totalRevenue.by('month');
const customerCount = Customers.metric('customerCount', { measure: 'count' });

describe('dataset publisher', () => {
  it('publishes datasets and metrics without mutating their definitions', () => {
    const registry = createDatasetPublisher()
      .publish(Orders, {
        metrics: { revenue: totalRevenue, monthlyRevenue },
      })
      .publish(Customers, { alias: 'accounts' })
      .build();

    expect(Object.keys(registry)).toEqual(['accounts', 'orders']);
    expect(registry.accounts.name).toBe('accounts');
    expect(getDatasetCatalog(registry.accounts).name).toBe('accounts');
    expect(registry.orders).not.toBe(Orders);
    expect(registry.orders.metrics.revenue).not.toBe(totalRevenue);
    expect(registry.orders.metrics.revenue.name).toBe('revenue');
    expect(registry.orders.metrics.revenue.contract().name).toBe('revenue');
    expect(registry.orders.metrics.revenue.contract().dataset).toBe('orders');
    expect(registry.orders.metrics.monthlyRevenue.metric.name).toBe('monthlyRevenue');
    expect(registry.orders.metrics.monthlyRevenue.contract().name).toBe('monthlyRevenue');
    expect('metrics' in Orders).toBe(false);
    expect(totalRevenue.name).toBe('totalRevenue');
  });

  it('preserves the existing semantic query behavior for matching public names', () => {
    const legacy = {
      orders: { ...Orders, metrics: { totalRevenue } },
    };
    const published = createDatasetPublisher()
      .publish(Orders, { metrics: { totalRevenue } })
      .build();

    const legacySchemas = buildCanonicalSemanticQuerySchemas(legacy);
    const publishedSchemas = buildCanonicalSemanticQuerySchemas(published);

    expect(publishedSchemas.queryDatasetJsonSchema).toEqual(legacySchemas.queryDatasetJsonSchema);
    expect(publishedSchemas.queryMetricJsonSchema).toEqual(legacySchemas.queryMetricJsonSchema);
    expect(publishedSchemas.manifestHash).toBe(legacySchemas.manifestHash);
  });

  it('executes a metric using its published alias', async () => {
    const registry = createDatasetPublisher()
      .publish(Orders, { metrics: { revenue: totalRevenue } })
      .build();
    const execute = vi.fn(async () => ({ data: [{ revenue: 42 }] }));
    const [tool] = generateDatasetTools({
      datasets: registry,
      analytics: { execute },
      mode: 'per-metric',
    });

    await tool.execute({});

    expect(tool.name).toBe('query_revenue');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'revenue' }),
      expect.any(Object),
      undefined,
    );
  });

  it('points relationships at the alias their target was published under', () => {
    const Accounts = dataset('account_records', {
      source: 'accounts',
      dimensions: { id: dimension.string(), country: dimension.string() },
    });
    const Invoices = dataset('invoices', {
      source: 'invoices',
      dimensions: { id: dimension.string(), accountId: dimension.string() },
      relationships: {
        account: belongsTo(() => Accounts, { from: 'accountId', to: 'id' }),
      },
    });

    const registry = createDatasetPublisher()
      .publish(Accounts, { alias: 'accounts' })
      .publish(Invoices)
      .build();

    // Without rewiring, `target()` still returns the original instance, so the
    // catalog would advertise `account_records` — a dataset the agent cannot
    // find in this registry.
    expect(getDatasetCatalog(registry.invoices).relationships.account)
      .toMatchObject({ target: 'accounts' });
    expect(projectAgentSafeCatalog(registry).datasets)
      .toContainEqual(expect.objectContaining({
        name: 'invoices',
        relationships: [{
          name: 'account',
          target: 'accounts',
          fields: ['account.country', 'account.id'],
        }],
      }));
    // Every advertised target resolves inside the published registry.
    for (const published of Object.values(registry)) {
      for (const relationship of Object.values(published.relationships)) {
        expect(Object.keys(registry)).toContain(relationship.target().name);
      }
    }
  });

  it('leaves a relationship alone when its target is not published', () => {
    const Warehouses = dataset('warehouses', {
      source: 'warehouses',
      dimensions: { id: dimension.string() },
    });
    const Shipments = dataset('shipments', {
      source: 'shipments',
      dimensions: { id: dimension.string(), warehouseId: dimension.string() },
      relationships: {
        warehouse: belongsTo(() => Warehouses, { from: 'warehouseId', to: 'id' }),
      },
    });

    const registry = createDatasetPublisher().publish(Shipments).build();

    expect(getDatasetCatalog(registry.shipments).relationships.warehouse)
      .toMatchObject({ target: 'warehouses' });
  });

  it('rewires relationships between two aliased datasets', () => {
    const Left = dataset('left_source', {
      source: 'left',
      dimensions: { id: dimension.string() },
    });
    const Right = dataset('right_source', {
      source: 'right',
      dimensions: { id: dimension.string(), leftId: dimension.string() },
      relationships: { left: belongsTo(() => Left, { from: 'leftId', to: 'id' }) },
    });

    const registry = createDatasetPublisher()
      .publish(Left, { alias: 'zebra' })
      .publish(Right, { alias: 'alpha' })
      .build();

    // `alpha` sorts before `zebra`, so its target is materialized after it —
    // the lookup must resolve on call rather than at rewiring time.
    expect(getDatasetCatalog(registry.alpha).relationships.left)
      .toMatchObject({ target: 'zebra' });
  });

  it('rejects invalid names, aliases, duplicate datasets, and foreign metrics', () => {
    expect(() => createDatasetPublisher().publish(Orders, { alias: 'sales-orders' })).toThrow(
      'Published dataset name "sales-orders"',
    );
    expect(() => createDatasetPublisher().publish(Orders, {
      metrics: { 'total-revenue': totalRevenue },
    })).toThrow('Published metric name "total-revenue"');
    expect(() => createDatasetPublisher()
      .publish(Orders, { alias: 'analytics' })
      .publish(Customers, { alias: 'analytics' }))
      .toThrow('Dataset alias "analytics" is already published.');
    expect(() => createDatasetPublisher()
      .publish(Orders)
      .publish(Orders, { alias: 'archived_orders' }))
      .toThrow('Dataset "orders" is already published.');
    expect(() => createDatasetPublisher().publish(Orders, {
      metrics: { customerCount: customerCount as MetricHandle },
    })).toThrow('belongs to dataset "customers", expected "orders"');
  });
});
