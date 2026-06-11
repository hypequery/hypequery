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

const Countries = dataset('countries', {
  source: 'countries',
  dimensions: {
    country: dimension.string(),
  },
});

const api = createAPI({
  datasets: { orders: Orders, countries: Countries },
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

// --- Datasets without measures do not widen measure fields to string ---------
type CountriesInput = Api['dataset:countries']['input'];

const okDimensionOnlyInput: CountriesInput = {
  dimensions: ['country'],
  orderBy: [{ field: 'country', direction: 'asc' }],
};
void okDimensionOnlyInput;

// @ts-expect-error - dimension-only datasets do not accept arbitrary measures
const badDimensionOnlyMeasure: CountriesInput = { measures: ['revenue'] };
void badDimensionOnlyMeasure;

const badDimensionOnlyOrderBy: CountriesInput = {
  orderBy: [
    // @ts-expect-error - orderBy cannot reference arbitrary measure fields
    { field: 'revenue', direction: 'desc' },
  ],
};
void badDimensionOnlyOrderBy;

type CountriesRow = Api['dataset:countries']['output']['data'][number];
const countriesRow: CountriesRow = {};
const countryName: string | undefined = countriesRow.country;
void countryName;

// @ts-expect-error - no broad measure index should be present
void countriesRow.revenue;

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
