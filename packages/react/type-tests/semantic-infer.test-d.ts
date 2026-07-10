import { createAnalyticsHooks } from '../src/index.js';

type Api = {
  revenue: {
    input: {
      dimensions?: readonly ('country' | 'status')[];
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
      dimensions?: readonly ('country' | 'status')[];
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
// Measure values are strings: ClickHouse serializes aggregates as strings over JSON.
const datasetRevenue: string | undefined = datasetRow?.revenue;
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
const groupedRevenue: string | undefined = groupedDatasetRow?.revenue;
const groupedOrderCount: string | undefined = groupedDatasetRow?.orderCount;
const groupedPeriod: string | undefined = groupedDatasetRow?.period;
void groupedCountry;
void groupedRevenue;
void groupedOrderCount;
void groupedPeriod;

// @ts-expect-error unselected dimensions are not exposed
void groupedDatasetRow?.status;

const metricResult = hooks.useMetric('revenue', {
  dimensions: ['country'] as const,
});
const metricRow = metricResult.data?.data[0];
const metricRevenue: string | undefined = metricRow?.revenue;
const metricCountry: string | undefined = metricRow?.country;

// @ts-expect-error metric values are strings, not numbers
const metricRevenueAsNumber: number | undefined = metricRow?.revenue;
void metricRevenueAsNumber;
void metricRevenue;
void metricCountry;

// @ts-expect-error unknown metric names should be rejected
hooks.useMetric('missing');

// @ts-expect-error unknown dataset names should be rejected
hooks.useDataset('missing', {});

// @ts-expect-error unknown dataset dimensions should be rejected
hooks.useDataset('orders', { dimensions: ['missing'] as const });

// @ts-expect-error unknown metric dimensions should be rejected
hooks.useMetric('revenue', { dimensions: ['missing'] as const });

export {};
