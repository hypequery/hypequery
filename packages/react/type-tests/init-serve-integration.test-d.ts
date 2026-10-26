/**
 * The serve→react seam for APIs built with `initServe(...).serve(...)` that
 * pass only `datasets` or only `metrics` (no `queries`). Omitting `queries`
 * must not widen the inferred Api to a string index signature, which would
 * type `useDataset` / `useMetric` names as `never`. Compiled by `tsc` via
 * `tsconfig.type-tests.json`; `@ts-expect-error` lines must remain errors.
 */

import { createAnalyticsHooks } from '../src/index.js';
import { initServe, type InferApiType } from '@hypequery/serve';
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

const { serve } = initServe({
  context: () => ({}),
  basePath: '/api/analytics',
});

// --- Datasets only ------------------------------------------------------------
const datasetsApi = serve({
  // The query builder is irrelevant to the type-level assertions below.
  queryBuilder: {} as never,
  datasets: { orders: Orders },
});

type DatasetsApi = InferApiType<typeof datasetsApi>;
const datasetKeys: keyof DatasetsApi = 'dataset:orders';
void datasetKeys;
// @ts-expect-error only configured keys exist on the inferred Api
const unknownDatasetKey: keyof DatasetsApi = 'anything';
void unknownDatasetKey;

const datasetHooks = createAnalyticsHooks<DatasetsApi>({ baseUrl: '/api' });
const datasetResult = datasetHooks.useDataset('orders', {
  dimensions: ['status'],
  measures: ['revenue'],
});
const datasetRow = datasetResult.data?.data[0];
const datasetStatus: string | undefined = datasetRow?.status;
const datasetRevenue: string | null | undefined = datasetRow?.revenue;
void datasetStatus;
void datasetRevenue;

// @ts-expect-error unknown measures are rejected
datasetHooks.useDataset('orders', { measures: ['revenu'] });
// @ts-expect-error unknown datasets are rejected
datasetHooks.useDataset('customers', { measures: ['revenue'] });

// --- Metrics only -------------------------------------------------------------
const metricsApi = serve({
  queryBuilder: {} as never,
  metrics: { totalRevenue },
});

type MetricsApi = InferApiType<typeof metricsApi>;
const metricKeys: keyof MetricsApi = 'totalRevenue';
void metricKeys;
// @ts-expect-error only configured keys exist on the inferred Api
const unknownMetricKey: keyof MetricsApi = 'anything';
void unknownMetricKey;

const metricHooks = createAnalyticsHooks<MetricsApi>({ baseUrl: '/api' });
const metricResult = metricHooks.useMetric('totalRevenue', { dimensions: ['status'] });
const metricRow = metricResult.data?.data[0];
const metricStatus: string | undefined = metricRow?.status;
const metricValue: string | null | undefined = metricRow?.totalRevenue;
void metricStatus;
void metricValue;

// @ts-expect-error unknown metrics are rejected
metricHooks.useMetric('totalRevenu', {});
// @ts-expect-error unknown dimensions are rejected
metricHooks.useMetric('totalRevenue', { dimensions: ['country'] });
