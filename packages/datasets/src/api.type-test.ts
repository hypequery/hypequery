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
  SemanticCacheOptions,
  SemanticCacheRuntime,
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
const _statusFilter = eq('status', 'completed');
const _createdAtRange = between('createdAt', '2025-01-01', '2025-01-31');
const _revenueSort = desc('revenueMetric');

type _MeasureOptionsIncludeFilters = Assert<
  Equal<HasKey<MeasureOptions, 'filters'>, true>
>;
type _MeasureFilterType = Assert<
  Equal<MeasureOptions['filters'], MetricFilter[] | undefined>
>;
type _TenantRuntimeShape = Assert<
  Equal<NonNullable<NonNullable<ExecutionContext['runtime']>['tenant']>, string | { id: string } | { in: string[] } | { scope: 'all' }>
>;
type _CacheRuntimeIncludesScope = Assert<
  Equal<NonNullable<ExecutionContext['cache']>, false | SemanticCacheRuntime>
>;
type _CacheRuntimeScopeType = Assert<
  Equal<SemanticCacheRuntime['scope'], string | undefined>
>;
type _CacheOptionsScopeType = Assert<
  Equal<SemanticCacheOptions['scope'], string | undefined>
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
  Equal<typeof revenueMetric, BaseMetricRef<'orders', 'revenueMetric', typeof Orders>>
>;
type _DerivedMetricRefKind = Assert<
  Equal<typeof averageRevenueMetric, DerivedMetricRef<'orders', 'averageRevenueMetric', typeof Orders>>
>;
type _DerivedUsesRequireBaseMetricsFromSameDataset = Assert<
  Equal<DerivedMetricConfig<'orders'>['uses'], Record<string, BaseMetricRef<'orders'>>>
>;
type _OtherDatasetBaseMetricDatasetName = Assert<
  Equal<typeof customerCountMetric['datasetName'], 'customers'>
>;
type _EqPreservesFieldLiteral = Assert<
  Equal<typeof _statusFilter['field'], 'status'>
>;
type _EqPreservesValueLiteral = Assert<
  Equal<typeof _statusFilter['value'], 'completed'>
>;
type _BetweenPreservesTupleValue = Assert<
  Equal<typeof _createdAtRange['value'], ['2025-01-01', '2025-01-31']>
>;
type _DescPreservesFieldLiteral = Assert<
  Equal<typeof _revenueSort['field'], 'revenueMetric'>
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

const _legacyTenantRuntimeContext: ExecutionContext = {
  runtime: {
    tenant: { id: 'tenant-1' },
  },
};

const _tenantSetRuntimeContext: ExecutionContext = {
  runtime: {
    tenant: { in: ['tenant-1', 'tenant-2'] },
  },
};

const _crossTenantRuntimeContext: ExecutionContext = {
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
    argMax: () => builderFactory.table('orders'),
    argMin: () => builderFactory.table('orders'),
    quantile: () => builderFactory.table('orders'),
    stddev: () => builderFactory.table('orders'),
    variance: () => builderFactory.table('orders'),
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

// -----------------------------------------------------------------------------
// Schema-typed builder acceptance (QueryBuilderFactoryInput)
//
// Simulates the shape of a schema-typed builder (e.g. createQueryBuilder<S>
// from @hypequery/clickhouse): literal column params, overloaded `where` with
// an expression-builder first overload, and a concrete `execute()` row type.
// Such builders cannot satisfy QueryBuilderFactoryLike structurally, but must
// be accepted by the public entry points. The real-builder counterpart lives
// in packages/clickhouse/type-tests/datasets-protocol.test.ts.
// -----------------------------------------------------------------------------

interface SimulatedTypedRow { id: number; status: string; amount: number }

interface SimulatedTypedBuilder {
  select(columns: ReadonlyArray<'id' | 'status' | 'amount'>): SimulatedTypedBuilder;
  sum<C extends 'amount' | 'id'>(column: C, alias?: string): SimulatedTypedBuilder;
  count(column: 'id' | 'status' | 'amount', alias?: string): SimulatedTypedBuilder;
  countDistinct(column: 'id' | 'status' | 'amount', alias?: string): SimulatedTypedBuilder;
  avg(column: 'amount', alias?: string): SimulatedTypedBuilder;
  min(column: 'amount', alias?: string): SimulatedTypedBuilder;
  max(column: 'amount', alias?: string): SimulatedTypedBuilder;
  where(expressionBuilder: (expr: { col: 'id' | 'status' | 'amount' }) => boolean): SimulatedTypedBuilder;
  where<C extends 'id' | 'status' | 'amount'>(column: C, operator: 'eq' | 'gt', value: SimulatedTypedRow[C]): SimulatedTypedBuilder;
  groupBy(columns: 'id' | 'status' | 'amount' | Array<'id' | 'status' | 'amount'>): SimulatedTypedBuilder;
  orderBy(column: 'id' | 'status' | 'amount', direction?: 'ASC' | 'DESC'): SimulatedTypedBuilder;
  limit(count: number): SimulatedTypedBuilder;
  offset(count: number): SimulatedTypedBuilder;
  toSQLWithParams(): { sql: string; parameters: unknown[] };
  execute(): Promise<SimulatedTypedRow[]>;
}

interface SimulatedTypedFactory {
  table<T extends 'orders'>(name: T): SimulatedTypedBuilder;
  rawQuery<T = SimulatedTypedRow>(sql: string, params?: unknown[]): Promise<T[]>;
}

declare const simulatedTypedFactory: SimulatedTypedFactory;

// Sanity: the simulated shape reproduces the original incompatibility.
// @ts-expect-error a schema-typed builder does not satisfy the strict protocol
const strictRejection: QueryBuilderFactoryLike = simulatedTypedFactory;

const typedAccepted: import('./index.js').QueryBuilderFactoryInput = simulatedTypedFactory;
const typedClient = createDatasetClient({ queryBuilder: simulatedTypedFactory });
const typedRuntime: ExecutionContext = { runtime: { builderFactory: simulatedTypedFactory } };

// @ts-expect-error non-builder objects are still rejected
const rejectedFactory: import('./index.js').QueryBuilderFactoryInput = { notABuilder: true };

void strictRejection;
void typedAccepted;
void typedClient;
void typedRuntime;
void rejectedFactory;
