import { add, dataset, dimension, measure, eq, between, desc, createDatasetClient } from './index.js';
import type {
  BaseMetricRef,
  DatasetClient,
  DatasetQuery,
  DatasetQueryResult,
  DerivedMetricConfig,
  DerivedMetricRef,
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
type DatasetInternalModule = typeof import('./internal.js');

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

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    customerCount: measure.count('id'),
  },
});

const revenueMetric = Orders.metric('revenueMetric', { measure: 'revenue' });
const completedRevenueMetric = Orders.metric('completedRevenueMetric', { measure: 'completedRevenue' });
const averageRevenueMetric = Orders.metric('averageRevenueMetric', {
  uses: { revenue: revenueMetric, completedRevenue: completedRevenueMetric },
  formula: ({ revenue, completedRevenue }) => add(revenue, completedRevenue),
});
const customerCountMetric = Customers.metric('customerCountMetric', { measure: 'customerCount' });
const statusFilter = eq('status', 'completed');
const createdAtRange = between('createdAt', '2025-01-01', '2025-01-31');
const revenueSort = desc('revenueMetric');

type _MeasureOptionsIncludeFilters = Assert<
  Equal<HasKey<MeasureOptions, 'filters'>, true>
>;
type _MeasureFilterType = Assert<
  Equal<MeasureOptions['filters'], MetricFilter[] | undefined>
>;
type _TenantRuntimeShape = Assert<
  Equal<NonNullable<NonNullable<ExecutionContext['runtime']>['tenant']>, string | { id: string } | { in: string[] } | { scope: 'all' }>
>;
type _DatasetHasNoQueryMethod = Assert<
  Equal<HasKey<typeof Orders, 'query'>, false>
>;
type _RootExportOmitsBuildDatasetQueryBuilder = Assert<
  Equal<HasKey<DatasetModule, 'buildDatasetQueryBuilder'>, false>
>;
type _RootExportOmitsRunDatasetQuery = Assert<
  Equal<HasKey<DatasetModule, 'runDatasetQuery'>, false>
>;
type _RootExportOmitsValidateDatasetQuery = Assert<
  Equal<HasKey<DatasetModule, 'validateDatasetQuery'>, false>
>;
type _RootExportIncludesCreateDatasetClient = Assert<
  Equal<HasKey<DatasetModule, 'createDatasetClient'>, true>
>;
type _RootExportOmitsCreateExecutor = Assert<
  Equal<HasKey<DatasetModule, 'createExecutor'>, false>
>;
type _RootExportOmitsSemanticExecutor = Assert<
  Equal<HasKey<DatasetModule, 'SemanticExecutor'>, false>
>;
type _RootExportOmitsMetricExecutor = Assert<
  Equal<HasKey<DatasetModule, 'MetricExecutor'>, false>
>;
type _InternalDatasetQueryTypeCompiles = import('./internal.js').DatasetQuery;
type _InternalExportIncludesBuildDatasetQueryBuilder = Assert<
  Equal<HasKey<DatasetInternalModule, 'buildDatasetQueryBuilder'>, true>
>;
type _InternalExportIncludesRunDatasetQuery = Assert<
  Equal<HasKey<DatasetInternalModule, 'runDatasetQuery'>, true>
>;
type _RootExportOmitsPlannerHelper = Assert<
  Equal<HasKey<DatasetModule, 'applyMeasureDefinition'>, false>
>;
type _DatasetNameLiteralIsPreserved = Assert<
  Equal<typeof Orders.name, 'orders'>
>;
type _BaseMetricDatasetNameLiteral = Assert<
  Equal<typeof revenueMetric['datasetName'], 'orders'>
>;
type _BaseMetricRefKind = Assert<
  Equal<typeof revenueMetric, BaseMetricRef<'orders', 'revenueMetric'>>
>;
type _DerivedMetricRefKind = Assert<
  Equal<typeof averageRevenueMetric, DerivedMetricRef<'orders', 'averageRevenueMetric'>>
>;
type _DerivedUsesRequireBaseMetricsFromSameDataset = Assert<
  Equal<DerivedMetricConfig<'orders'>['uses'], Record<string, BaseMetricRef<'orders'>>>
>;
type _OtherDatasetBaseMetricDatasetName = Assert<
  Equal<typeof customerCountMetric['datasetName'], 'customers'>
>;
type _EqPreservesFieldLiteral = Assert<
  Equal<typeof statusFilter['field'], 'status'>
>;
type _EqPreservesValueLiteral = Assert<
  Equal<typeof statusFilter['value'], 'completed'>
>;
type _BetweenPreservesTupleValue = Assert<
  Equal<typeof createdAtRange['value'], ['2025-01-01', '2025-01-31']>
>;
type _DescPreservesFieldLiteral = Assert<
  Equal<typeof revenueSort['field'], 'revenueMetric'>
>;

Orders.metric('validDerivedMetric', {
  uses: { revenue: revenueMetric },
  formula: ({ revenue }) => add(revenue, revenue),
});

// @ts-expect-error derived metrics can only use base metrics from the same dataset.
Orders.metric('invalidCrossDatasetDerivedMetric', {
  uses: { customerCount: customerCountMetric },
  formula: () => add('customerCount', 'customerCount'),
});

// @ts-expect-error derived metrics can only use base metrics, not derived metric refs.
Orders.metric('invalidDerivedFromDerivedMetric', {
  uses: { averageRevenue: averageRevenueMetric },
  formula: () => add('averageRevenue', 'averageRevenue'),
});

const runtimeContext: ExecutionContext = {
  runtime: {
    tenant: 'tenant-1',
  },
};

const legacyTenantRuntimeContext: ExecutionContext = {
  runtime: {
    tenant: { id: 'tenant-1' },
  },
};

const tenantSetRuntimeContext: ExecutionContext = {
  runtime: {
    tenant: { in: ['tenant-1', 'tenant-2'] },
  },
};

const crossTenantRuntimeContext: ExecutionContext = {
  runtime: {
    tenant: { scope: 'all' },
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

const analytics = createDatasetClient({ queryBuilder: builderFactory });
const explicitAnalytics: DatasetClient = analytics;
const datasetQuery: DatasetQuery = { dimensions: ['status'], measures: ['revenue'] };

analytics.validate(revenueMetric, { dimensions: ['status'] }, runtimeContext);
analytics.toSQL(completedRevenueMetric, { dimensions: ['status'] }, runtimeContext);
analytics.toSQL(revenueMetric, { orderBy: [desc('revenueMetric')] }, runtimeContext);
analytics.validate(Orders, datasetQuery, runtimeContext);
analytics.toSQL(Orders, datasetQuery, runtimeContext);
void analytics.execute<DatasetQueryResult['data'][number]>(Orders, datasetQuery, runtimeContext);

void runtimeContext;
void explicitAnalytics;
