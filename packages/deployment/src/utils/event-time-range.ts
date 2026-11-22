import type { ProtocolExpression } from '@hypequery/protocol';

/** A bounded time range read from an RFC 0027 operation's filters, as instants. */
export interface EventTimeRange {
  readonly startMs: number;
  readonly endMs: number;
  /** The query zone the scan reads offset-free bounds and buckets in. */
  readonly timezone: string;
}

const ISO_BOUND = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function zoneParts(at: number, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

/** How far `timezone`'s wall clock is ahead of UTC at instant `at`. */
function zoneOffset(at: number, timezone: string): number {
  const parts = zoneParts(at, timezone);
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * An ISO date or timestamp as an instant. A bound with `Z` or an offset is
 * already one; an offset-free bound is a wall clock in `timezone`, exactly as
 * the scan compares it (RFC 0025).
 */
export function parseEventTimeBound(value: unknown, timezone = 'UTC'): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_BOUND.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour = '00', minute = '00', second = '00', offset] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    return undefined;
  }
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  const clock = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const wall = Date.parse(`${clock}${offset ?? 'Z'}`);
  if (!Number.isFinite(wall)) return undefined;
  if (offset !== undefined || timezone === 'UTC') return wall;
  // Two passes settle a wall clock next to a DST change.
  return wall - zoneOffset(wall - zoneOffset(wall, timezone), timezone);
}

function literalValues(expression: ProtocolExpression): readonly unknown[] | undefined {
  if (expression.kind !== 'comparison' || !('right' in expression) || expression.right.kind !== 'literal') {
    return undefined;
  }
  const value = expression.right.value as unknown;
  if (typeof value === 'object' && value !== null && '$hypequery' in value) {
    const tag = (value as { $hypequery: { values?: readonly unknown[] } }).$hypequery;
    return tag.values;
  }
  return [value];
}

/**
 * Exactly one bounded range on the time field: one `between`, or one
 * `gt`/`gte` with one `lt`/`lte`, with ISO bounds. The rule window measures
 * already follow, so a caller learns one shape.
 */
export function eventTimeRange(
  filters: readonly ProtocolExpression[],
  isTimeFilter: (name: string) => boolean,
  timezone = 'UTC',
): EventTimeRange | undefined {
  const time = filters.filter(filter => (
    filter.kind === 'comparison' && filter.left.kind === 'reference' && isTimeFilter(String(filter.left.name))
  ));
  let lower: unknown;
  let upper: unknown;
  if (time.length === 1 && time[0]!.kind === 'comparison' && time[0]!.operator === 'between') {
    [lower, upper] = literalValues(time[0]!) ?? [];
  } else if (time.length === 2) {
    const operator = (filter: ProtocolExpression) => (filter.kind === 'comparison' ? filter.operator : '');
    const start = time.find(filter => operator(filter) === 'gt' || operator(filter) === 'gte');
    const end = time.find(filter => operator(filter) === 'lt' || operator(filter) === 'lte');
    if (!start || !end) return undefined;
    lower = literalValues(start)?.[0];
    upper = literalValues(end)?.[0];
  } else {
    return undefined;
  }
  const startMs = parseEventTimeBound(lower, timezone);
  const endMs = parseEventTimeBound(upper, timezone);
  if (startMs === undefined || endMs === undefined || endMs < startMs) return undefined;
  return { startMs, endMs, timezone };
}

const DAY_MS = 86_400_000;

/**
 * An upper bound on the buckets a range spans at a grain in its query zone.
 * Days and weeks round the span up and add one for a partial first bucket;
 * a DST day is at most an hour longer, which the rounding absorbs. Months
 * are counted from the local calendar months the two bounds fall in.
 */
export function estimateEventBuckets(range: EventTimeRange, grain: 'day' | 'week' | 'month'): number {
  const spanDays = Math.ceil((range.endMs - range.startMs) / DAY_MS);
  if (grain === 'day') return spanDays + 1;
  if (grain === 'week') return Math.ceil(spanDays / 7) + 1;
  const start = zoneParts(range.startMs, range.timezone);
  const end = zoneParts(range.endMs, range.timezone);
  return (end.year! - start.year!) * 12 + end.month! - start.month! + 1;
}

export function eventRangeDays(range: EventTimeRange): number {
  return (range.endMs - range.startMs) / DAY_MS;
}
