import type { ProtocolExpression } from '@hypequery/protocol';

/** A bounded time range read from an RFC 0027 operation's filters. */
export interface EventTimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

const ISO_BOUND = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** An ISO date or timestamp, read as UTC when it carries no offset. */
export function parseEventTimeBound(value: unknown): number | undefined {
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
  const milliseconds = Date.parse(`${clock}${offset ?? 'Z'}`);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
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
  const startMs = parseEventTimeBound(lower);
  const endMs = parseEventTimeBound(upper);
  if (startMs === undefined || endMs === undefined || endMs < startMs) return undefined;
  return { startMs, endMs };
}

const DAY_MS = 86_400_000;

/**
 * An upper estimate of the buckets a range spans at a grain, in UTC. A zone
 * can shift a boundary into one more bucket, which the `+ 1` covers.
 */
export function estimateEventBuckets(range: EventTimeRange, grain: 'day' | 'week' | 'month'): number {
  const spanDays = Math.ceil((range.endMs - range.startMs) / DAY_MS);
  if (grain === 'day') return spanDays + 1;
  if (grain === 'week') return Math.ceil(spanDays / 7) + 1;
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
}

export function eventRangeDays(range: EventTimeRange): number {
  return (range.endMs - range.startMs) / DAY_MS;
}
