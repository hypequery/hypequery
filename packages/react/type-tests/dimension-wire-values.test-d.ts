/**
 * Dimension values on the `InferApiType` path describe what serve's JSON
 * carries. Dimensions pass through ClickHouse JSON unnormalized: the built-in
 * adapter quotes Int64 and wider integers as strings, and Nullable columns
 * yield null. Datasets declare neither column types nor nullability, so
 * numeric dimensions are `number | string` and every dimension may be null,
 * as on the generated-client path (`generated-client.test-d.ts`).
 */

import type { Expect, Equal } from '@type-challenges/utils';
import { createAnalyticsHooks } from '../src/index.js';
import { createAPI, type InferApiType } from '@hypequery/serve';
import { dataset, dimension, measure } from '@hypequery/datasets';

const Events = dataset('events', {
  source: 'events',
  timeKey: 'created_at',
  dimensions: {
    userId: dimension.number({ column: 'user_id' }),
    country: dimension.string(),
    isPaid: dimension.boolean({ column: 'is_paid' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    eventCount: measure.count('user_id'),
  },
});

const eventCount = Events.metric('eventCount', { measure: 'eventCount' });

const api = createAPI({
  datasets: { events: Events },
  metrics: { eventCount },
  queryBuilder: {} as never,
});

const hooks = createAnalyticsHooks<InferApiType<typeof api>>({ baseUrl: '/api/analytics' });

// --- Dataset rows --------------------------------------------------------------
const datasetResult = hooks.useDataset('events', {
  dimensions: ['userId', 'country', 'isPaid', 'createdAt'] as const,
  measures: ['eventCount'] as const,
  by: 'month',
});
type DatasetRow = NonNullable<typeof datasetResult.data>['data'][number];
type _DatasetUserId = Expect<Equal<DatasetRow['userId'], number | string | null | undefined>>;
type _DatasetCountry = Expect<Equal<DatasetRow['country'], string | null | undefined>>;
type _DatasetIsPaid = Expect<Equal<DatasetRow['isPaid'], boolean | null | undefined>>;
type _DatasetCreatedAt = Expect<Equal<DatasetRow['createdAt'], string | null | undefined>>;
type _DatasetMeasure = Expect<Equal<DatasetRow['eventCount'], string | null | undefined>>;
type _DatasetPeriod = Expect<Equal<DatasetRow['period'], string | null | undefined>>;

declare const datasetRow: DatasetRow;
// @ts-expect-error UInt64/Int64 dimensions arrive as strings, so the value is not always a number
const userIdAsNumber: number | undefined = datasetRow.userId;
void userIdAsNumber;
// @ts-expect-error a Nullable column yields null
const countryWithoutNull: string | undefined = datasetRow.country;
void countryWithoutNull;

// --- Metric rows -----------------------------------------------------------------
const metric = hooks.useMetric('eventCount', { dimensions: ['userId'] as const });
type MetricRow = NonNullable<typeof metric.data>['data'][number];
type _MetricUserId = Expect<Equal<MetricRow['userId'], number | string | null | undefined>>;
type _MetricValue = Expect<Equal<MetricRow['eventCount'], string | null | undefined>>;

// --- Infinite pages follow the same projection ----------------------------------
const infinite = hooks.useInfiniteDataset('events', {
  dimensions: ['userId'] as const,
  measures: ['eventCount'] as const,
  limit: 50,
});
type InfiniteRow = NonNullable<typeof infinite.data>['pages'][number]['data'][number];
type _InfiniteUserId = Expect<Equal<InfiniteRow['userId'], number | string | null | undefined>>;

const infiniteMetric = hooks.useInfiniteMetric('eventCount', {
  dimensions: ['userId'] as const,
  limit: 50,
});
type InfiniteMetricRow = NonNullable<typeof infiniteMetric.data>['pages'][number]['data'][number];
type _InfiniteMetricUserId = Expect<Equal<InfiniteMetricRow['userId'], number | string | null | undefined>>;

export {};
