import { dataset, dimension, measure, eq, desc, MetricExecutor } from './index.js';
import type {
  ExecutionContext,
  MeasureOptions,
  MetricFilter,
  QueryBuilderFactoryLike,
} from './index.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type DatasetModule = typeof import('./index.js');

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

type _MeasureOptionsIncludeFilters = Assert<
  Equal<HasKey<MeasureOptions, 'filters'>, true>
>;
type _MeasureFilterType = Assert<
  Equal<MeasureOptions['filters'], MetricFilter[] | undefined>
>;
type _TenantRuntimeShape = Assert<
  Equal<keyof NonNullable<NonNullable<ExecutionContext['runtime']>['tenant']>, 'id'>
>;
type _DatasetHasNoQueryMethod = Assert<
  Equal<HasKey<typeof Orders, 'query'>, false>
>;
type _RootExportOmitsDatasetQueryRef = Assert<
  Equal<HasKey<DatasetModule, 'DatasetQueryRef'>, false>
>;
type _RootExportOmitsPlannerHelper = Assert<
  Equal<HasKey<DatasetModule, 'applyMeasureDefinition'>, false>
>;

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
executor.toSQL(revenueMetric, { orderBy: [desc('revenueMetric')] }, runtimeContext);

void runtimeContext;
