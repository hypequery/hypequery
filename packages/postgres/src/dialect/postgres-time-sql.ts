import type { TimeGrain } from '@hypequery/datasets';

const INTERVALS: Record<TimeGrain, string> = {
  minute: "INTERVAL '1 minute'",
  hour: "INTERVAL '1 hour'",
  day: "INTERVAL '1 day'",
  week: "INTERVAL '7 days'",
  month: "INTERVAL '1 month'",
  quarter: "INTERVAL '3 months'",
  year: "INTERVAL '1 year'",
};

/**
 * Bucket start, in the result types ClickHouse returns: sub-day and day
 * buckets as timestamps (`YYYY-MM-DD HH:MM:SS`), week and coarser as dates.
 * Weeks start on Sunday to match datasets' shipped ClickHouse `toStartOfWeek`
 * (mode 0); Postgres `date_trunc('week')` alone starts on Monday.
 */
export function truncateTime(time: string, grain: TimeGrain): string {
  switch (grain) {
    case 'minute':
    case 'hour':
    case 'day':
      return `date_trunc('${grain}', ${time})`;
    case 'week':
      return `(date_trunc('week', (${time}) + INTERVAL '1 day') - INTERVAL '1 day')::date`;
    case 'month':
    case 'quarter':
    case 'year':
      return `date_trunc('${grain}', ${time})::date`;
  }
}

export function addTime(time: string, amount: string | number, grain: TimeGrain): string {
  return `((${time}) + (${amount}) * ${INTERVALS[grain]})`;
}

export function subtractTime(time: string, amount: number, grain: TimeGrain): string {
  if (!Number.isSafeInteger(amount)) throw new Error('A time shift amount must be an integer.');
  return `((${time}) - ${amount} * ${INTERVALS[grain]})`;
}

/** Grain boundaries crossed from `start` to `end`, like ClickHouse `dateDiff`. */
export function timeDiff(grain: TimeGrain, start: string, end: string): string {
  const epoch = (value: string, unit: string) => `EXTRACT(EPOCH FROM date_trunc('${unit}', ${value}))`;
  const months = (value: string) => `(EXTRACT(YEAR FROM ${value}) * 12 + EXTRACT(MONTH FROM ${value}))`;
  switch (grain) {
    case 'minute': return `((${epoch(end, 'minute')} - ${epoch(start, 'minute')}) / 60)::bigint`;
    case 'hour': return `((${epoch(end, 'hour')} - ${epoch(start, 'hour')}) / 3600)::bigint`;
    case 'day': return `((${end})::date - (${start})::date)::bigint`;
    case 'week': return `((${truncateTime(end, 'week')} - ${truncateTime(start, 'week')}) / 7)::bigint`;
    case 'month': return `(${months(end)} - ${months(start)})::bigint`;
    case 'quarter': return `(floor((${months(end)} - 1) / 3) - floor((${months(start)} - 1) / 3))::bigint`;
    case 'year': return `(EXTRACT(YEAR FROM ${end}) - EXTRACT(YEAR FROM ${start}))::bigint`;
  }
}

/**
 * A source time as a wall-clock `timestamp` in `timezone`. `timestamptz`
 * converts by instant; a zone-less `timestamp` is read as UTC, the zone the
 * driver pins the session to (as a zone-less ClickHouse DateTime is read in
 * the server zone); a `date` stays the local date it names.
 */
export function toQueryTimezone(time: string, timezone: string): string {
  return `(CASE WHEN pg_typeof(${time}) = 'date'::regtype THEN (${time})::timestamp `
    + `ELSE (${time})::timestamptz AT TIME ZONE '${timezone}' END)`;
}
