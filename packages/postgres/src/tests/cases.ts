/**
 * Dataset queries shared by the Postgres golden corpus and the cross-engine
 * parity suite. Names and queries match the ClickHouse golden corpus.
 */
import type { DatasetQuery, TimeGrain } from '@hypequery/datasets';

const GRAINS: TimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];
const HOUR_RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-03-07 00:00:00', '2026-03-09 00:00:00'] }];

export const datasetCases: Record<string, DatasetQuery> = {
  'aggregate-every-measure': {
    dimensions: ['status'],
    measures: ['revenue', 'orders', 'buyers', 'approxBuyers', 'avgAmount', 'minAmount', 'maxAmount', 'p95', 'topRegion', 'bottomRegion', 'spread', 'variance'],
  },
  'aggregate-filtered-measures': { dimensions: ['region'], measures: ['paidRevenue', 'giftOrders', 'regionalOrders', 'p95Paid'] },
  'aggregate-filters-order-pagination': {
    dimensions: ['status', 'region'],
    measures: ['revenue'],
    filters: [
      { field: 'status', operator: 'in', value: ['paid', 'shipped'] },
      { field: 'status', operator: 'like', value: '%a%' },
      { field: 'createdAt', operator: 'gte', value: '2026-01-01' },
    ],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
    limit: 25,
    offset: 50,
  },
  'aggregate-segment': { dimensions: ['region'], measures: ['revenue'], segments: ['paid'] },
  'relationship-dimension-and-measure': { dimensions: ['customer.country'], measures: ['revenue', 'customer.customers'] },
  'derived-measures': { dimensions: ['status'], measures: ['averageOrderValue', 'everyFormula'], orderBy: [{ field: 'averageOrderValue', direction: 'desc' }], limit: 10 },
  'derived-by-grain-with-offset': { by: 'month', measures: ['averageOrderValue'], offset: 20 },
  'having': {
    dimensions: ['customerId'],
    measures: ['revenue', 'averageOrderValue'],
    having: [
      { measure: 'revenue', operator: 'gt', value: 100 },
      { measure: 'averageOrderValue', operator: 'between', value: [10, 50] },
    ],
  },
  'timezone-new-york': { by: 'day', measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-01-02' }], timezone: 'America/New_York' },
  'window-trailing-and-to-date': { by: 'day', dimensions: ['status'], measures: ['revenue', 'rolling', 'rollingBuyers', 'monthToDate'], filters: RANGE },
  'window-cumulative': { by: 'week', measures: ['running', 'runningOrders'], filters: RANGE, timezone: 'Europe/Berlin' },
  'window-exclusive-bounds': {
    by: 'day', measures: ['rolling'],
    filters: [{ field: 'createdAt', operator: 'gt', value: '2026-01-01' }, { field: 'createdAt', operator: 'lt', value: '2026-04-01' }],
  },
  'shift-calendar-and-derived': { by: 'day', dimensions: ['region'], measures: ['revenue', 'priorYear', 'priorMonth', 'yearOverYear'], filters: RANGE },
  'shift-wall-time-guard': { by: 'hour', measures: ['priorHour', 'priorMonth'], filters: HOUR_RANGE, timezone: 'America/New_York' },
  'composite-shifted-formula': { by: 'month', dimensions: ['status'], measures: ['priorAov', 'averageOrderValue'], filters: RANGE },
  'composite-window-formula': { by: 'day', measures: ['rollingShare'], filters: RANGE },
  'composite-cumulative-nested-formula': { by: 'day', dimensions: ['status'], measures: ['runningAovRounded'], filters: RANGE },
  'composite-to-date-nested-formula': { by: 'day', measures: ['monthToDateShareRounded'], filters: RANGE, timezone: 'Asia/Tokyo' },
  'window-analytical-aggregates-with-limit': { by: 'day', measures: ['rollingP95', 'rollingTop'], filters: RANGE, limit: 500 },
  'instant-filter': { measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-01-02T05:00:00Z' }], timezone: 'America/New_York' },
};
for (const grain of GRAINS) {
  datasetCases[`grain-${grain}`] = { by: grain, dimensions: ['status'], measures: ['revenue'] };
}


const NY_SPRING = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-03-07 00:00:00', '2026-03-09 00:00:00'] }];
const NY_FALL = [{ field: 'createdAt', operator: 'between' as const, value: ['2025-11-01 00:00:00', '2025-11-03 00:00:00'] }];

/** Edge cases run only by the cross-engine parity suite. */
export const parityOnlyCases: Record<string, DatasetQuery> = {
  'hour-grain-dst-spring': { by: 'hour', measures: ['revenue', 'orders'], filters: NY_SPRING, timezone: 'America/New_York' },
  'hour-grain-dst-fall': { by: 'hour', measures: ['revenue', 'orders'], filters: NY_FALL, timezone: 'America/New_York' },
  'hour-trailing-dst-spring': { by: 'hour', measures: ['revenue', 'rolling'], filters: NY_SPRING, timezone: 'America/New_York' },
  'hour-trailing-dst-fall': { by: 'hour', measures: ['revenue', 'rolling'], filters: NY_FALL, timezone: 'America/New_York' },
  'hour-shift-dst-fall': { by: 'hour', measures: ['priorHour'], filters: NY_FALL, timezone: 'America/New_York' },
  'relationship-dimension-time-measures': {
    by: 'month', dimensions: ['customer.country'], measures: ['revenue', 'running', 'priorMonth'],
    filters: [{ field: 'createdAt', operator: 'between', value: ['2025-06-01', '2026-04-01'] }],
  },
  'cumulative-by-dimension-kathmandu': {
    by: 'day', dimensions: ['status'], measures: ['running', 'runningOrders'],
    filters: [{ field: 'createdAt', operator: 'between', value: ['2026-02-01', '2026-03-01'] }], timezone: 'Asia/Kathmandu',
  },
  'week-shift-prior-year': { by: 'week', measures: ['revenue', 'priorYear', 'yearOverYear'], filters: RANGE },
  'quarter-shift-prior-year': { by: 'quarter', dimensions: ['region'], measures: ['revenue', 'priorYear'], filters: RANGE },
  'instant-bounds-sub-second': {
    by: 'day', measures: ['revenue', 'rolling', 'monthToDate'],
    filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01T00:00:00.500Z', '2026-02-01T05:00:00Z'] }],
    timezone: 'America/Los_Angeles',
  },
  'exclusive-instant-bounds-to-date': {
    by: 'day', measures: ['monthToDate', 'priorMonth'],
    filters: [{ field: 'createdAt', operator: 'gt', value: '2026-02-10T12:00:00Z' }, { field: 'createdAt', operator: 'lt', value: '2026-03-05T00:00:00Z' }],
  },
  'unguarded-division': { dimensions: ['region'], measures: ['unguarded'] },
  'composite-tokyo-utc-control': { by: 'day', measures: ['monthToDateShareRounded', 'rollingShare'], filters: RANGE },
  'filtered-measures-under-windows': {
    by: 'week', dimensions: ['region'], measures: ['paidRevenue', 'giftOrders'],
    filters: RANGE,
  },
  'guard-window-fanout': { by: 'minute', measures: ['rolling'], filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01 00:00:00', '2026-01-01 01:00:00'] }] },
  'guard-result-limit': { by: 'day', measures: ['rolling'], filters: RANGE, limit: 10 },
  'guard-local-result-limit': {
    by: 'hour', measures: ['rolling'], filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01 00:00:00', '2026-01-03 00:00:00'] }],
    timezone: 'America/New_York', limit: 48,
  },
};
