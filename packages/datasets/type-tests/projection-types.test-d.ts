import { createDatasetClient, dataset, dimension, measure, type AnyDatasetInstance, type DatasetQueryFor } from '../src/index.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
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
  const country: string | undefined = row.country;
  const revenue: number | undefined = row.revenue;
  void country;
  void revenue;

  // @ts-expect-error unselected dimensions are not exposed
  void row.status;
  // @ts-expect-error unselected measures are not exposed
  void row.orderCount;
  // @ts-expect-error period is only exposed for grained queries
  void row.period;
}

async function assertMeasuresOnlyProjection() {
  const result = await analytics.execute(Orders, {
    measures: ['revenue'] as const,
  });
  const row = result.data[0]!;
  const revenue: number | undefined = row.revenue;
  void revenue;

  // @ts-expect-error dimensions are not exposed when omitted
  void row.country;
}

async function assertOmittedMeasuresExposeAllMeasures() {
  const result = await analytics.execute(Orders, {
    dimensions: ['country'] as const,
  });
  const row = result.data[0]!;
  const revenue: number | undefined = row.revenue;
  const orderCount: number | undefined = row.orderCount;
  void revenue;
  void orderCount;
}

async function assertPeriodProjection() {
  const result = await analytics.execute(Orders, {
    measures: ['revenue'] as const,
    by: 'month',
  });
  const row = result.data[0]!;
  const period: string | undefined = row.period;
  void period;
}

async function assertMetricProjection() {
  const result = await analytics.execute(totalRevenue, {
    dimensions: ['country'] as const,
  });
  const row = result.data[0]!;
  const country: string | undefined = row.country;
  const revenue: number | undefined = row.revenue;
  void country;
  void revenue;

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
  const period: string | undefined = row.period;
  void period;
}

void assertDatasetProjection;
void assertMeasuresOnlyProjection;
void assertOmittedMeasuresExposeAllMeasures;
void assertPeriodProjection;
void assertMetricProjection;
void assertMetricPeriodProjection;
