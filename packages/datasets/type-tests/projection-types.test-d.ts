import {
  createDatasetClient,
  belongsTo,
  dataset,
  dimension,
  hasMany,
  measure,
  type AnyDatasetInstance,
  type DatasetQueryFor,
  type DatasetDimensionNames,
  type DatasetRow,
  type MetricRow,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    country: dimension.string(),
    tier: dimension.string(),
    computed: dimension.string({ sql: 'upper(country)' }),
  },
});

const Items = dataset('items', {
  source: 'items',
  dimensions: {
    sku: dimension.string(),
  },
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    uniqueCustomers: measure.countDistinct('customer_id'),
    averageOrderValue: measure.avg('amount'),
    smallestOrder: measure.min('amount'),
    largestOrder: measure.max('amount'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
    items: hasMany(() => Items, { from: 'id', to: 'order_id' }),
  },
});

const totalRevenue = Orders.metric('revenue', { measure: 'revenue' });
const analytics = createDatasetClient({ backend: {} as never });

const wideDatasetQuery: DatasetQueryFor<AnyDatasetInstance> = {
  dimensions: ['any_dimension'],
  measures: ['any_measure'],
  orderBy: [{ field: 'any_measure', direction: 'desc' }],
};
void wideDatasetQuery;

async function assertDatasetProjection() {
  const result = await analytics.execute(Orders, {
    dimensions: ['country'] as const,
    measures: ['revenue'] as const,
  });
  const row = result.data[0]!;

  // Dimensions keep their declared type; measure values are strings because
  // ClickHouse serializes aggregate results (UInt64, Decimal, ...) as strings
  // over JSON — matching the query builder's AggregationType.
  type _Country = Assert<Equal<typeof row.country, string | undefined>>;
  type _Revenue = Assert<Equal<typeof row.revenue, string | undefined>>;

  // @ts-expect-error measure values are strings, not numbers
  const revenueAsNumber: number | undefined = row.revenue;
  void revenueAsNumber;

  // @ts-expect-error unselected dimensions are not exposed
  void row.status;
  // @ts-expect-error unselected measures are not exposed
  void row.orderCount;
  // @ts-expect-error period is only exposed for grained queries
  void row.period;
}

async function assertRelationshipProjection() {
  const result = await analytics.execute(Orders, {
    dimensions: ['customer.country'] as const,
    measures: ['revenue'] as const,
    orderBy: [{ field: 'customer.country', direction: 'asc' }] as const,
  });
  const row = result.data[0]!;

  type _CustomerCountry = Assert<Equal<typeof row['customer.country'], string | undefined>>;

  type _HasManyExcluded = Assert<
    Equal<Extract<DatasetDimensionNames<typeof Orders>, 'items.sku'>, never>
  >;
  type _SqlDimensionExcluded = Assert<
    Equal<Extract<DatasetDimensionNames<typeof Orders>, 'customer.computed'>, never>
  >;
}

async function assertEveryAggregationEmitsString() {
  const result = await analytics.execute(Orders, {
    measures: [
      'revenue',
      'orderCount',
      'uniqueCustomers',
      'averageOrderValue',
      'smallestOrder',
      'largestOrder',
    ] as const,
  });
  const row = result.data[0]!;

  type _Sum = Assert<Equal<typeof row.revenue, string | undefined>>;
  type _Count = Assert<Equal<typeof row.orderCount, string | undefined>>;
  type _CountDistinct = Assert<Equal<typeof row.uniqueCustomers, string | undefined>>;
  type _Avg = Assert<Equal<typeof row.averageOrderValue, string | undefined>>;
  type _Min = Assert<Equal<typeof row.smallestOrder, string | undefined>>;
  type _Max = Assert<Equal<typeof row.largestOrder, string | undefined>>;
}

async function assertMeasuresOnlyProjection() {
  const result = await analytics.execute(Orders, {
    measures: ['revenue'] as const,
  });
  const row = result.data[0]!;
  type _Revenue = Assert<Equal<typeof row.revenue, string | undefined>>;

  // @ts-expect-error dimensions are not exposed when omitted
  void row.country;
}

async function assertOmittedMeasuresExposeAllMeasures() {
  const result = await analytics.execute(Orders, {
    dimensions: ['country'] as const,
  });
  const row = result.data[0]!;
  type _Revenue = Assert<Equal<typeof row.revenue, string | undefined>>;
  type _OrderCount = Assert<Equal<typeof row.orderCount, string | undefined>>;
}

async function assertPeriodProjection() {
  const result = await analytics.execute(Orders, {
    measures: ['revenue'] as const,
    by: 'month',
  });
  const row = result.data[0]!;
  type _Period = Assert<Equal<typeof row.period, string | undefined>>;
}

async function assertMetricProjection() {
  const result = await analytics.execute(totalRevenue, {
    dimensions: ['country'] as const,
  });
  const row = result.data[0]!;
  type _Country = Assert<Equal<typeof row.country, string | undefined>>;
  type _Revenue = Assert<Equal<typeof row.revenue, string | undefined>>;

  // @ts-expect-error metric values are strings, not numbers
  const revenueAsNumber: number | undefined = row.revenue;
  void revenueAsNumber;

  // @ts-expect-error unselected dimensions are not exposed
  void row.status;
  // @ts-expect-error period is only exposed for grained queries
  void row.period;
}

async function assertMetricPeriodProjection() {
  const result = await analytics.execute(totalRevenue, {
    dimensions: ['country'] as const,
    by: 'month',
  });
  const row = result.data[0]!;
  type _Period = Assert<Equal<typeof row.period, string | undefined>>;
}

// The projection-independent row types make the same string choice.
function assertBroadRowTypes() {
  const datasetRow = {} as DatasetRow<typeof Orders>;
  type _NumberDimension = Assert<Equal<typeof datasetRow.amount, number | undefined>>;
  type _Revenue = Assert<Equal<typeof datasetRow.revenue, string | undefined>>;
  type _OrderCount = Assert<Equal<typeof datasetRow.orderCount, string | undefined>>;
  type _Period = Assert<Equal<typeof datasetRow.period, string | undefined>>;

  const metricRow = {} as MetricRow<typeof Orders, 'revenue'>;
  type _MetricValue = Assert<Equal<typeof metricRow.revenue, string | undefined>>;
  type _MetricCountry = Assert<Equal<typeof metricRow.country, string | undefined>>;
}

void assertDatasetProjection;
void assertRelationshipProjection;
void assertEveryAggregationEmitsString;
void assertMeasuresOnlyProjection;
void assertOmittedMeasuresExposeAllMeasures;
void assertPeriodProjection;
void assertMetricProjection;
void assertMetricPeriodProjection;
void assertBroadRowTypes;
