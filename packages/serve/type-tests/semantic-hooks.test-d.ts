/**
 * Compile-time checks that `InferAPIType` carries field-level types through the
 * semantic endpoint map: dataset/metric inputs constrain dimension/measure/
 * orderBy fields, and result rows are typed. Compiled by `tsc` via
 * `tsconfig.type-tests.json`; `@ts-expect-error` lines must remain errors.
 */

import { createAPI } from '../src/server/create-api.js';
import type { InferAPIType } from '../src/types.js';
import { dataset, dimension, measure } from '@hypequery/datasets';

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
    orderCount: measure.count('country'),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

const api = createAPI({
  datasets: { orders: Orders },
  metrics: { totalRevenue },
  // The query builder is irrelevant to the type-level assertions below.
  queryBuilder: {} as never,
});

type Api = InferAPIType<typeof api>;

// --- Dataset input: dimensions/measures narrowed to the dataset's fields -----
type OrdersInput = Api['dataset:orders']['input'];

const okDatasetInput: OrdersInput = {
  dimensions: ['country', 'status', 'amount'],
  measures: ['revenue', 'orderCount'],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  by: 'month',
};
void okDatasetInput;

// @ts-expect-error - unknown dimension name
const badDatasetDim: OrdersInput = { dimensions: ['nope'] };
void badDatasetDim;

// @ts-expect-error - unknown measure name
const badDatasetMeasure: OrdersInput = { measures: ['nope'] };
void badDatasetMeasure;

// --- Dataset output rows are typed by dimension/measure -----------------------
type OrdersRow = Api['dataset:orders']['output']['data'][number];
const datasetRow: OrdersRow = {};
const rowCountry: string | undefined = datasetRow.country;
const rowRevenue: number | undefined = datasetRow.revenue;
void rowCountry;
void rowRevenue;

// @ts-expect-error - field is not part of the dataset
void datasetRow.nonexistent;

// --- Metric input: intentionally loose (see SemanticMetricEndpointMap note) ---
// `MetricRef` does not preserve its dataset's concrete dimension keys, so metric
// fields stay string-typed until the dataset generics are threaded through
// `MetricRef`. These assertions document the current contract.
type MetricInput = Api['totalRevenue']['input'];

const okMetricInput: MetricInput = {
  dimensions: ['country'],
  orderBy: [{ field: 'totalRevenue', direction: 'desc' }],
  by: 'month',
};
void okMetricInput;

type MetricRowT = Api['totalRevenue']['output']['data'][number];
const metricRow: MetricRowT = {};
void metricRow.totalRevenue;

export {};
