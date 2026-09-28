import type { TimeGrain, WindowMeasureDefinition } from '../types.js';
import type { ParsedTimeBound } from './time-axis-bounds.js';

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

/** Exact conversions from RFC 0015; calendar months never become days. */
export function intervalBuckets(amount: number, unit: TimeGrain, grain: TimeGrain): number | undefined {
  const units = FIXED_MINUTES[unit] ?? CALENDAR_MONTHS[unit];
  const buckets = FIXED_MINUTES[grain] ?? CALENDAR_MONTHS[grain];
  const bothFixed = FIXED_MINUTES[unit] !== undefined && FIXED_MINUTES[grain] !== undefined;
  const bothCalendar = CALENDAR_MONTHS[unit] !== undefined && CALENDAR_MONTHS[grain] !== undefined;
  if (units === undefined || buckets === undefined || (!bothFixed && !bothCalendar)) return undefined;
  const count = amount * units / buckets;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

/** UTC estimate; SQL uses the time expression's timezone for exact buckets. */
export function utcBucketStart(timestamp: number, grain: TimeGrain): number {
  const date = new Date(timestamp);
  if (grain === 'minute') {
    date.setUTCSeconds(0, 0);
    return date.getTime();
  }
  if (grain === 'hour') {
    date.setUTCMinutes(0, 0, 0);
    return date.getTime();
  }
  date.setUTCHours(0, 0, 0, 0);
  if (grain === 'week') date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  if (grain === 'month' || grain === 'quarter' || grain === 'year') date.setUTCDate(1);
  if (grain === 'quarter') date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
  if (grain === 'year') date.setUTCMonth(0);
  return date.getTime();
}

/** Check the authored window's compatibility and maximum per-row contribution. */
export function windowGrainErrors(name: string, window: WindowMeasureDefinition, grain: TimeGrain): string[] {
  const count = window.trailing
    ? intervalBuckets(window.trailing.amount, window.trailing.unit, grain)
    : window.toDate ? MAX_TO_DATE_BUCKETS[window.toDate]?.[grain] : 1;
  if (count === undefined) {
    const toDateRequirement = window.toDate ? ' at a strictly coarser grain' : '';
    return [`Window measure "${name}" must span whole "${grain}" buckets${toDateRequirement}.`];
  }
  if (count > 1000) return [`Window measure "${name}" would make a row contribute to more than 1,000 buckets.`];
  return [];
}

/** Estimate only: SQL determines exact bucket counts in the query timezone. */
export function estimateTimeAxisBuckets(
  start: ParsedTimeBound,
  end: ParsedTimeBound,
  upperInclusive: boolean,
  grain: TimeGrain,
): number {
  const first = utcBucketStart(start.milliseconds, grain);
  const upperBucket = utcBucketStart(end.milliseconds, grain);
  const excludesUpperBucket = !upperInclusive && !end.subMillisecond && end.milliseconds === upperBucket;
  const last = utcBucketStart(end.milliseconds - (excludesUpperBucket ? 1 : 0), grain);
  const calendar = CALENDAR_MONTHS[grain];
  if (calendar !== undefined) {
    const firstDate = new Date(first);
    const lastDate = new Date(last);
    const months = (lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12
      + lastDate.getUTCMonth() - firstDate.getUTCMonth();
    return months / calendar + 1;
  }
  return (last - first) / ((FIXED_MINUTES[grain] ?? 1) * 60000) + 1;
}

/** Leave mixed bounds and local sub-day ranges to SQL's timezone-aware check. */
export function exceedsEstimatedTimeAxisLimit(
  start: ParsedTimeBound,
  end: ParsedTimeBound,
  grain: TimeGrain,
  bucketCount: number,
  resultLimit: number | undefined,
): boolean {
  if (resultLimit === undefined) return false;
  const canEstimate = start.hasOffset === end.hasOffset
    && (start.hasOffset || (grain !== 'minute' && grain !== 'hour'));
  // Allow two boundary buckets because the query timezone is unknown.
  return resultLimit === 0 || (canEstimate && bucketCount - 2 > resultLimit);
}
