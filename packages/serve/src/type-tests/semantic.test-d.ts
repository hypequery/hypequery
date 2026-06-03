import { dataset, dimension, measure, divide, nullIfZero, belongsTo } from '../semantic/index.js';
import { createAPI } from '../index.js';
import type { QueryBuilderFactoryLike } from '@hypequery/datasets';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
    name: dimension.string(),
    country: dimension.string(),
  },
  measures: {
    customerCount: measure.count('id'),
  },
});

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    customerId: dimension.string({ column: 'customer_id' }),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const orderCountMetric = Orders.metric('orderCountMetric', { measure: 'orderCount' });
const avgOrderValue = Orders.metric('avgOrderValue', {
  uses: { revenue: totalRevenue, orders: orderCountMetric },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
});
const monthlyRevenue = totalRevenue.by('month');

monthlyRevenue.contract();
avgOrderValue.contract();

const queryBuilder: QueryBuilderFactoryLike = {
  table: (() => {
    throw new Error('type-only query builder');
  }) as QueryBuilderFactoryLike['table'],
  rawQuery: async () => [],
};

const semanticApi = createAPI({
  metrics: { totalRevenue },
  datasets: { orders: Orders },
  queryBuilder,
});

void semanticApi.execute('totalRevenue', {
  input: { dimensions: ['status'] },
});

void semanticApi.execute('dataset:orders', {
  input: { dimensions: ['status'], measures: ['revenue'] },
});

// @ts-expect-error only configured semantic keys are executable
void semanticApi.execute('dataset:customers', { input: {} });
