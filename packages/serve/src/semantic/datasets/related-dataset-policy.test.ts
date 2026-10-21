import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, measure, type QueryBuilderFactoryLike } from '@hypequery/datasets';
import { createAPI } from '../../server/create-api.js';
import { createBearerTokenStrategy } from '../../auth.js';
import { ServeHttpError } from '../../errors.js';
import {
  assertRelatedDatasetAccess,
  collectRelatedDatasetPolicies,
} from './utils/related-dataset-policy.js';

const Shipments = dataset('shipments', {
  source: 'shipments',
  dimensions: { orderId: dimension.string({ column: 'order_id' }), carrier: dimension.string() },
  measures: { shipped: measure.countDistinct('order_id') },
});

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { id: dimension.string(), country: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  relationships: { shipment: belongsTo(() => Shipments, { from: 'id', to: 'order_id' }) },
});

const reader = { userId: 'alice', scopes: ['orders:read'] };
const shipper = { userId: 'bob', scopes: ['orders:read', 'shipments:read'] };

// The QA repro: a caller refused by the shipments endpoint read shipment data
// through the orders endpoint, whose scopes say nothing about shipments.
const policies = collectRelatedDatasetPolicies({
  orders: { dataset: Orders, requiredScopes: ['orders:read'] },
  shipments: { dataset: Shipments, requiredScopes: ['shipments:read'] },
});

const relatedQueries = {
  dimension: { dimensions: ['shipment.carrier'] },
  measure: { measures: ['shipment.shipped'] },
  filter: { filters: [{ field: 'shipment.carrier', operator: 'eq' as const, value: 'ups' }] },
  orderBy: { dimensions: ['country'], orderBy: [{ field: 'shipment.carrier', direction: 'asc' as const }] },
};

describe('related dataset policy', () => {
  it.each(Object.entries(relatedQueries))('refuses a %s on a served related dataset the caller cannot read', (_, query) => {
    expect(() => assertRelatedDatasetAccess(Orders, query, reader, policies)).toThrow(ServeHttpError);
    expect(() => assertRelatedDatasetAccess(Orders, query, null, policies)).toThrow(/related dataset "shipment"/);
  });

  it.each(Object.entries(relatedQueries))('allows a %s when the caller satisfies the related endpoint', (_, query) => {
    expect(() => assertRelatedDatasetAccess(Orders, query, shipper, policies)).not.toThrow();
  });

  it('leaves local fields and unserved related datasets alone', () => {
    expect(() => assertRelatedDatasetAccess(Orders, { dimensions: ['country'] }, reader, policies)).not.toThrow();
    const ordersOnly = collectRelatedDatasetPolicies({ orders: { dataset: Orders, requiredScopes: ['orders:read'] } });
    expect(() => assertRelatedDatasetAccess(Orders, relatedQueries.dimension, reader, ordersOnly)).not.toThrow();
  });

  it('admits a caller satisfying any entry that serves the related dataset', () => {
    const twoEntries = collectRelatedDatasetPolicies({
      shipments: { dataset: Shipments, requiredScopes: ['shipments:read'] },
      shipmentsPublicView: { dataset: Shipments, requiredRoles: ['ops'] },
    });
    expect(() => assertRelatedDatasetAccess(Orders, relatedQueries.dimension, { roles: ['ops'] }, twoEntries)).not.toThrow();
    expect(() => assertRelatedDatasetAccess(Orders, relatedQueries.dimension, reader, twoEntries)).toThrow(ServeHttpError);
  });

  it('answers 403 through createAPI before planning the query', async () => {
    let planned = false;
    const queryBuilder = (() => { planned = true; throw new Error('not reached'); }) as unknown as QueryBuilderFactoryLike;
    const api = createAPI({
      queryBuilder,
      auth: createBearerTokenStrategy({ validate: token => (token === 'reader' ? reader : null) }),
      datasets: {
        orders: { dataset: Orders, requiredScopes: ['orders:read'] },
        shipments: { dataset: Shipments, requiredScopes: ['shipments:read'] },
      },
    });
    const response = await api.handler({
      method: 'POST',
      path: '/api/analytics/datasets/orders/query',
      headers: { authorization: 'Bearer reader', 'content-type': 'application/json' },
      query: {},
      body: { dimensions: ['shipment.carrier'] },
    });
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toContain('related dataset');
    expect(planned).toBe(false);
  });
});
