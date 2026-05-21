import { dataset, dimension, measure, eq, MetricExecutor } from './index.js';
import type { ExecutionContext, QueryBuilderFactoryLike } from './index.js';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
});

const revenueMetric = Orders.metric('revenueMetric', { measure: 'revenue' });
const completedRevenueMetric = Orders.metric('completedRevenueMetric', { measure: 'completedRevenue' });

const runtimeContext: ExecutionContext = {
  runtime: {
    tenant: {
      id: 'tenant-1',
    },
  },
};

const builderFactory: QueryBuilderFactoryLike = {
  table: () => ({
    select: () => builderFactory.table('orders'),
    sum: () => builderFactory.table('orders'),
    count: () => builderFactory.table('orders'),
    countDistinct: () => builderFactory.table('orders'),
    avg: () => builderFactory.table('orders'),
    min: () => builderFactory.table('orders'),
    max: () => builderFactory.table('orders'),
    where: () => builderFactory.table('orders'),
    groupBy: () => builderFactory.table('orders'),
    orderBy: () => builderFactory.table('orders'),
    limit: () => builderFactory.table('orders'),
    offset: () => builderFactory.table('orders'),
    toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  }),
  rawQuery: async () => [],
};

const executor = new MetricExecutor({ builderFactory });

executor.validate(revenueMetric, { dimensions: ['status'] }, runtimeContext);
executor.toSQL(completedRevenueMetric, { dimensions: ['status'] }, runtimeContext);

void runtimeContext;
