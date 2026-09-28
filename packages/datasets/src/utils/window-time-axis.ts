import type { AnyDatasetInstance, DatasetQuery, MetricFilter, TimeGrain } from '../types.js';
import { isSupportedTimeGrain } from '../constants.js';
import { selectedWindowMeasures } from './window-query-measures.js';

const FIXED_MINUTES: Partial<Record<TimeGrain, number>> = { minute: 1, hour: 60, day: 1440, week: 10080 };
const CALENDAR_MONTHS: Partial<Record<TimeGrain, number>> = { month: 1, quarter: 3, year: 12 };
const MAX_TO_DATE_BUCKETS: Partial<Record<TimeGrain, Partial<Record<TimeGrain, number>>>> = {
  hour: { minute: 60 },
  day: { minute: 1440, hour: 24 },
  week: { minute: 10080, hour: 168, day: 7 },
  month: { minute: 44640, hour: 744, day: 31 },
  quarter: { minute: 132480, hour: 2208, day: 92, month: 3 },
  year: { minute: 527040, hour: 8784, day: 366, month: 12, quarter: 4 },
};

export interface WindowTimeAxis {
  grain: TimeGrain;
  lower: string;
  upper: string;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  filters: MetricFilter[];
  bucketCount: number;
  resultLimit?: number;
}

/** Exact conversions from RFC 0015; calendar months never become days. */
export function intervalBuckets(amount: number, unit: TimeGrain, grain: TimeGrain): number | undefined {
  const units = FIXED_MINUTES[unit] ?? CALENDAR_MONTHS[unit];
  const buckets = FIXED_MINUTES[grain] ?? CALENDAR_MONTHS[grain];
  if (units === undefined || buckets === undefined || Boolean(FIXED_MINUTES[unit]) !== Boolean(FIXED_MINUTES[grain])) return undefined;
  const count = amount * units / buckets;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

/** UTC estimate; SQL uses the physical time column's timezone for exact buckets. */
export function utcBucketStart(timestamp: number, grain: TimeGrain): number {
  const date = new Date(timestamp);
  if (grain === 'minute') { date.setUTCSeconds(0, 0); return date.getTime(); }
  if (grain === 'hour') { date.setUTCMinutes(0, 0, 0); return date.getTime(); }
  date.setUTCHours(0, 0, 0, 0);
  if (grain === 'week') date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  if (grain === 'month' || grain === 'quarter' || grain === 'year') date.setUTCDate(1);
  if (grain === 'quarter') date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
  if (grain === 'year') date.setUTCMonth(0);
  return date.getTime();
}

function timestamp(value: unknown): { text: string; milliseconds: number; subMillisecond: boolean; nanoseconds: bigint; hasOffset: boolean } | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return undefined;
  const text = value.includes('T') || value.includes(' ') ? value : `${value}T00:00:00`;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined;
  const clock = /[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (clock && (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59)) return undefined;
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) return undefined;
  const fraction = /\.(\d+)/.exec(text)?.[1] ?? '';
  return { text: value, milliseconds, subMillisecond: /[1-9]/.test(fraction.slice(3)), hasOffset: /(?:Z|[+-]\d{2}:\d{2})$/.test(value), nanoseconds: BigInt(milliseconds) * 1000000n + BigInt(fraction.padEnd(9, '0').slice(3)) };
}

function timeColumn(dataset: AnyDatasetInstance, name: string): string {
  return dataset.dimensions[name]?.column ?? name;
}

export function analyzeWindowTimeAxis(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
): { axis?: WindowTimeAxis; errors: string[] } {
  const windows = selectedWindowMeasures(dataset, query);
  if (windows.size === 0) return { errors: [] };
  const errors: string[] = [];
  if (!isSupportedTimeGrain(query.by)) return { errors: ['Window measures require a supported "by" grain.'] };
  const grain = query.by;
  for (const [name, window] of windows) {
    const count = window.trailing
      ? intervalBuckets(window.trailing.amount, window.trailing.unit, grain)
      : window.toDate ? MAX_TO_DATE_BUCKETS[window.toDate]?.[grain] : 1;
    if (count === undefined) errors.push(`Window measure "${name}" must span whole "${grain}" buckets${window.toDate ? ' at a strictly coarser grain' : ''}.`);
    else if (count > 1000) errors.push(`Window measure "${name}" would make a row contribute to more than 1,000 buckets.`);
  }
  const timeFilters = (query.filters ?? []).filter(filter => {
    const field = dataset.filters[filter.field]?.field ?? filter.field;
    return !field.includes('.') && timeColumn(dataset, field) === timeColumn(dataset, dataset.timeKey ?? '');
  });
  let lower: unknown;
  let upper: unknown;
  let lowerInclusive = true;
  let upperInclusive = true;
  if (timeFilters.length === 1 && timeFilters[0]?.operator === 'between' && Array.isArray(timeFilters[0].value) && timeFilters[0].value.length === 2) {
    [lower, upper] = timeFilters[0].value;
  } else if (timeFilters.length === 2) {
    const start = timeFilters.find(filter => filter.operator === 'gt' || filter.operator === 'gte');
    const end = timeFilters.find(filter => filter.operator === 'lt' || filter.operator === 'lte');
    lower = start?.value;
    upper = end?.value;
    lowerInclusive = start?.operator === 'gte';
    upperInclusive = end?.operator === 'lte';
  }
  const start = timestamp(lower);
  const end = timestamp(upper);
  if (!start || !end) return { errors: [...errors, 'Window measures require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.'] };
  if (start.hasOffset === end.hasOffset && (start.nanoseconds > end.nanoseconds || (start.nanoseconds === end.nanoseconds && !(lowerInclusive && upperInclusive)))) {
    return { errors: [...errors, 'Window measure time range must be non-empty and ordered.'] };
  }
  const first = utcBucketStart(start.milliseconds, grain);
  const last = utcBucketStart(end.milliseconds - (!upperInclusive && !end.subMillisecond && end.milliseconds === utcBucketStart(end.milliseconds, grain) ? 1 : 0), grain);
  const calendar = CALENDAR_MONTHS[grain];
  const firstDate = new Date(first);
  const lastDate = new Date(last);
  const bucketCount = calendar
    ? ((lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 + lastDate.getUTCMonth() - firstDate.getUTCMonth()) / calendar + 1
    : (last - first) / ((FIXED_MINUTES[grain] ?? 1) * 60000) + 1;
  const resultLimit = query.limit ?? dataset.limits?.maxResultSize;
  // The column timezone is unknown here. Mixed local/offset endpoints and
  // local sub-day ranges need SQL's exact check (including DST). Other UTC
  // estimates allow two boundary buckets; SQL guards expansion in every case.
  const canEstimateLimit = start.hasOffset === end.hasOffset && (start.hasOffset || (grain !== 'minute' && grain !== 'hour'));
  if (resultLimit === 0 || (canEstimateLimit && resultLimit !== undefined && bucketCount - 2 > resultLimit)) errors.push(`Window series exceeds the effective result limit of ${resultLimit} buckets.`);
  return {
    errors,
    axis: { grain, lower: start.text, upper: end.text, lowerInclusive, upperInclusive, filters: (query.filters ?? []).filter(filter => !timeFilters.includes(filter)), bucketCount, resultLimit },
  };
}
