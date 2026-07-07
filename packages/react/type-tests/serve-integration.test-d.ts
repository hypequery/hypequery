/**
 * Integration checks for the serve→react seam: the Api type inferred from a
 * real `createAPI()` (not a hand-written fixture) must drive name and
 * projection inference in `createAnalyticsHooks`. This is what catches
 * regressions in serve's `__hypequerySemantic` metadata that
 * `semantic-infer.test-d.ts` cannot, because its fixture spells the metadata
 * out by hand. Compiled by `tsc` via `tsconfig.type-tests.json`;
 * `@ts-expect-error` lines must remain errors.
 */

import { createAnalyticsHooks } from '../src/index.js';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { dataset, dimension, measure } from '@hypequery/datasets';

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

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

const api = createAPI({
  datasets: { orders: Orders },
  metrics: { totalRevenue },
  // The query builder is irrelevant to the type-level assertions below.
  queryBuilder: {} as never,
});

type Api = InferApiType<typeof api>;

const hooks = createAnalyticsHooks<Api>({
  baseUrl: '/api/analytics',
});

// --- Dataset rows follow the literal projection -------------------------------
const datasetResult = hooks.useDataset('orders', {
  dimensions: ['country'] as const,
  measures: ['revenue'] as const,
});
const datasetRow = datasetResult.data?.data[0];
const datasetCountry: string | undefined = datasetRow?.country;
// Measure values are strings: ClickHouse serializes aggregates as strings over JSON.
const datasetRevenue: string | undefined = datasetRow?.revenue;
void datasetCountry;
void datasetRevenue;

// @ts-expect-error measure values are strings, not numbers
const datasetRevenueAsNumber: number | undefined = datasetRow?.revenue;
void datasetRevenueAsNumber;

// @ts-expect-error unselected dimensions are not exposed
void datasetRow?.status;
// @ts-expect-error unselected measures are not exposed
void datasetRow?.orderCount;
// @ts-expect-error period is only exposed for grained queries
void datasetRow?.period;

// --- Grained dataset queries expose period ------------------------------------
const grainedResult = hooks.useDataset('orders', {
  measures: ['revenue'] as const,
  by: 'month',
});
const grainedPeriod: string | undefined = grainedResult.data?.data[0]?.period;
void grainedPeriod;

// --- Metric rows carry the metric value plus selected dimensions ---------------
const metricResult = hooks.useMetric('totalRevenue', {
  dimensions: ['country'] as const,
});
const metricRow = metricResult.data?.data[0];
const metricValue: string | undefined = metricRow?.totalRevenue;
const metricCountry: string | undefined = metricRow?.country;
void metricValue;
void metricCountry;

// @ts-expect-error unselected dimensions are not exposed
void metricRow?.status;

// --- Infinite hooks follow the same projection ---------------------------------
const infiniteDatasetResult = hooks.useInfiniteDataset('orders', {
  dimensions: ['country'] as const,
  measures: ['revenue'] as const,
  limit: 50,
});
const infiniteDatasetRow = infiniteDatasetResult.data?.pages[0]?.data[0];
const infiniteDatasetCountry: string | undefined = infiniteDatasetRow?.country;
const infiniteDatasetRevenue: string | undefined = infiniteDatasetRow?.revenue;
void infiniteDatasetCountry;
void infiniteDatasetRevenue;

// @ts-expect-error unselected dimensions are not exposed on infinite pages
void infiniteDatasetRow?.status;
// @ts-expect-error unselected measures are not exposed on infinite pages
void infiniteDatasetRow?.orderCount;

const infiniteGrainedResult = hooks.useInfiniteDataset('orders', {
  measures: ['revenue'] as const,
  by: 'month',
  limit: 50,
});
const infiniteGrainedPeriod: string | undefined =
  infiniteGrainedResult.data?.pages[0]?.data[0]?.period;
void infiniteGrainedPeriod;

const infiniteMetricResult = hooks.useInfiniteMetric('totalRevenue', {
  dimensions: ['country'] as const,
  limit: 50,
});
const infiniteMetricRow = infiniteMetricResult.data?.pages[0]?.data[0];
const infiniteMetricValue: string | undefined = infiniteMetricRow?.totalRevenue;
const infiniteMetricCountry: string | undefined = infiniteMetricRow?.country;
void infiniteMetricValue;
void infiniteMetricCountry;

// @ts-expect-error unselected dimensions are not exposed on infinite metric pages
void infiniteMetricRow?.status;

// @ts-expect-error unknown infinite dataset dimensions should be rejected
hooks.useInfiniteDataset('orders', { dimensions: ['missing'] as const });

// @ts-expect-error unknown infinite metric names should be rejected
hooks.useInfiniteMetric('missing', {});

// --- Unknown names and fields are rejected -------------------------------------
// @ts-expect-error unknown metric names should be rejected
hooks.useMetric('missing');

// @ts-expect-error unknown dataset names should be rejected
hooks.useDataset('missing', {});

// @ts-expect-error unknown dataset dimensions should be rejected
hooks.useDataset('orders', { dimensions: ['missing'] as const });

// @ts-expect-error unknown metric dimensions should be rejected
hooks.useMetric('totalRevenue', { dimensions: ['missing'] as const });

export {};
