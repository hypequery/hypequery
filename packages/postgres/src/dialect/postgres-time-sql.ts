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

/** RFC 3339 offsets as the datasets bound parser accepts them (`Z` or `±HH:MM`). */
const OFFSET_SUFFIX = "'(Z|[+-][0-9]{2}:[0-9]{2})$'";

/**
 * A bound (a text placeholder) as a wall clock in the query zone. Text with
 * an offset is an instant, converted to that zone; offset-free text is
 * already a wall-clock reading there.
 */
export function parseTimestamp(value: string, timezone: string): string {
  const text = `CAST(${value} AS text)`;
  return `(CASE WHEN ${text} ~ ${OFFSET_SUFFIX} THEN CAST(${text} AS timestamptz) AT TIME ZONE ${timezone} `
    + `ELSE CAST(${text} AS timestamp) END)`;
}

/** Interval arithmetic widens a date bucket to a timestamp: restore the bucket's date type. */
export function periodValue(expression: string, grain: TimeGrain): string {
  return grain === 'minute' || grain === 'hour' || grain === 'day' ? expression : `CAST(${expression} AS date)`;
}

/**
 * Time rules for planning in one query timezone, where times are instants
 * (`timestamptz`), as ClickHouse DateTime64 values carrying the query zone.
 * Wall clocks cannot tell apart the hour a DST fall-back repeats, so
 * instants are bucketed, stepped and compared; the wall clock is read only
 * to truncate, to count calendar boundaries, and in the result `period`.
 */
export function zonedTimeRules(timezone: string) {
  const zone = `'${timezone}'`;
  const wall = (time: string) => `(${time} AT TIME ZONE ${zone})`;
  const instant = (wallClock: string) => `(${wallClock} AT TIME ZONE ${zone})`;
  const isSubDay = (grain: TimeGrain) => grain === 'minute' || grain === 'hour';
  const step = (time: string, operator: '+' | '-', amount: string | number, grain: TimeGrain) => isSubDay(grain)
    // Minutes and hours are elapsed time; calendar units move the wall clock.
    ? `((${time}) ${operator} (${amount}) * ${INTERVALS[grain]})`
    : instant(`(${wall(time)} ${operator} (${amount}) * ${INTERVALS[grain]})`);
  return {
    toQueryTimezone: (time: string, queryTimezone: string) =>
      `(CASE WHEN pg_typeof(${time}) = 'date'::regtype THEN (${time})::timestamp AT TIME ZONE '${queryTimezone}' `
      + `ELSE (${time})::timestamptz END)`,
    parseTimestamp: (value: string, timezoneSql: string) => {
      const text = `CAST(${value} AS text)`;
      return `(CASE WHEN ${text} ~ ${OFFSET_SUFFIX} THEN CAST(${text} AS timestamptz) `
        + `ELSE CAST(${text} AS timestamp) AT TIME ZONE ${timezoneSql} END)`;
    },
    truncateTime: (time: string, grain: TimeGrain) => grain === 'week'
      ? instant(`(date_trunc('week', ${wall(time)} + INTERVAL '1 day') - INTERVAL '1 day')`)
      : `date_trunc('${grain}', ${time}, ${zone})`,
    addTime: (time: string, amount: string | number, grain: TimeGrain) => step(time, '+', amount, grain),
    subtractTime: (time: string, amount: number, grain: TimeGrain) => {
      if (!Number.isSafeInteger(amount)) throw new Error('A time shift amount must be an integer.');
      return step(time, '-', amount, grain);
    },
    timeDiff: (grain: TimeGrain, start: string, end: string) => {
      if (!isSubDay(grain)) return timeDiff(grain, wall(start), wall(end));
      const epoch = (value: string) => `EXTRACT(EPOCH FROM date_trunc('${grain}', ${value}, ${zone}))`;
      return `((${epoch(end)} - ${epoch(start)}) / ${grain === 'hour' ? 3600 : 60})::bigint`;
    },
    clockPart: (part: 'Hour' | 'Minute' | 'Second', time: string) =>
      `FLOOR(EXTRACT(${part.toUpperCase()} FROM ${wall(time)}))::int`,
    periodValue: (expression: string, grain: TimeGrain) => grain === 'minute' || grain === 'hour' || grain === 'day'
      ? wall(expression)
      : `CAST(${wall(expression)} AS date)`,
  };
}
