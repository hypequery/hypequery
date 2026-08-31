import { createAnalyticsHooks } from '../src/index.js';

type Api = {
  revenue: {
    input: {
      dimensions?: readonly ('country' | 'status' | 'customer.country')[];
      by?: 'month';
    };
    output: {
      data: Array<{ revenue?: string }>;
    };
    readonly __hypequerySemantic?: {
      kind: 'metric';
      dimensions: {
        country: { fieldType: 'string' };
        status: { fieldType: 'string' };
        'customer.country': { fieldType: 'string' };
      };
      measures: {
        revenue: { aggregation: 'sum' };
        orderCount: { aggregation: 'count' };
      };
      metricName: 'revenue';
    };
  };
  'dataset:orders': {
    input: {
      dimensions?: readonly ('country' | 'status' | 'customer.country')[];
      measures?: readonly ('revenue' | 'orderCount')[];
      by?: 'month';
    };
    output: {
      data: Array<{ revenue?: string; orderCount?: string }>;
    };
    readonly __hypequerySemantic?: {
      kind: 'dataset';
      dimensions: {
        country: { fieldType: 'string' };
        status: { fieldType: 'string' };
        'customer.country': { fieldType: 'string' };
      };
      measures: {
        revenue: { aggregation: 'sum' };
        orderCount: { aggregation: 'count' };
      };
    };
  };
};

const hooks = createAnalyticsHooks<Api>({
  baseUrl: 'https://api.example.com',
});

const datasetResult = hooks.useDataset('orders', {
  measures: ['revenue'] as const,
});
const datasetRow = datasetResult.data?.data[0];
// Measure values are normalized strings, with SQL NULL preserved.
const datasetRevenue: string | null | undefined = datasetRow?.revenue;
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

const groupedDatasetResult = hooks.useDataset('orders', {
  dimensions: ['country'] as const,
  by: 'month',
});
const groupedDatasetRow = groupedDatasetResult.data?.data[0];
const groupedCountry: string | undefined = groupedDatasetRow?.country;
const groupedRevenue: string | null | undefined = groupedDatasetRow?.revenue;
const groupedOrderCount: string | null | undefined = groupedDatasetRow?.orderCount;
const groupedPeriod: string | undefined = groupedDatasetRow?.period;
void groupedCountry;
void groupedRevenue;
void groupedOrderCount;
void groupedPeriod;

const relatedDatasetResult = hooks.useDataset('orders', {
  dimensions: ['customer.country'] as const,
  measures: ['revenue'] as const,
});
const relatedCountry: string | undefined =
  relatedDatasetResult.data?.data[0]?.['customer.country'];
void relatedCountry;

// @ts-expect-error unselected dimensions are not exposed
void groupedDatasetRow?.status;

const metricResult = hooks.useMetric('revenue', {
  dimensions: ['country'] as const,
});
const metricRow = metricResult.data?.data[0];
const metricRevenue: string | null | undefined = metricRow?.revenue;
const metricCountry: string | undefined = metricRow?.country;

// @ts-expect-error metric values are strings, not numbers
const metricRevenueAsNumber: number | undefined = metricRow?.revenue;
void metricRevenueAsNumber;
void metricRevenue;
void metricCountry;

const relatedMetricResult = hooks.useMetric('revenue', {
  dimensions: ['customer.country'] as const,
});
const relatedMetricCountry: string | undefined =
  relatedMetricResult.data?.data[0]?.['customer.country'];
void relatedMetricCountry;

// @ts-expect-error unknown metric names should be rejected
hooks.useMetric('missing');

// @ts-expect-error unknown dataset names should be rejected
hooks.useDataset('missing', {});

// @ts-expect-error unknown dataset dimensions should be rejected
hooks.useDataset('orders', { dimensions: ['missing'] as const });

// @ts-expect-error unknown metric dimensions should be rejected
hooks.useMetric('revenue', { dimensions: ['missing'] as const });

export {};
