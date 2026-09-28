import type { AnyDatasetInstance, MetricFilter } from '../types.js';

export interface ParsedTimeBound {
  /** Preserve the authored text: SQL interprets local bounds in the column timezone. */
  text: string;
  /** UTC instant for offset bounds; a wall-clock estimate for local bounds. */
  milliseconds: number;
  subMillisecond: boolean;
  nanoseconds: bigint;
  hasOffset: boolean;
}

export interface TimeAxisRange {
  start: ParsedTimeBound;
  end: ParsedTimeBound;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  filters: MetricFilter[];
}

const ISO_TIME_BOUND = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Parse without applying the process timezone, preserving nanosecond precision. */
export function parseTimeBound(value: unknown): ParsedTimeBound | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_TIME_BOUND.exec(value);
  if (!match) return undefined;
  const [, day, hour, minute, second, fraction = '', offset] = match;

  // Date.parse normalizes invalid calendar dates, so verify the authored day first.
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined;
  if (Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 59) return undefined;

  const clock = hour === undefined ? `${day}T00:00:00` : value.replace(' ', 'T');
  const hasOffset = offset !== undefined;
  const milliseconds = Date.parse(hasOffset ? clock : `${clock}Z`);
  if (!Number.isFinite(milliseconds)) return undefined;
  const nanosecondRemainder = BigInt(fraction.padEnd(9, '0').slice(3));
  return {
    text: value,
    milliseconds,
    subMillisecond: nanosecondRemainder !== 0n,
    nanoseconds: BigInt(milliseconds) * 1000000n + nanosecondRemainder,
    hasOffset,
  };
}

function timeColumn(dataset: AnyDatasetInstance, name: string): string {
  return dataset.dimensions[name]?.column ?? name;
}

/** Extract exactly one bounded time range, retaining all non-time predicates. */
export function resolveTimeAxisRange(dataset: AnyDatasetInstance, filters: MetricFilter[]): TimeAxisRange | undefined {
  const timeFilters = filters.filter(filter => {
    const field = dataset.filters[filter.field]?.field ?? filter.field;
    return !field.includes('.') && timeColumn(dataset, field) === timeColumn(dataset, dataset.timeKey ?? '');
  });
  let lower: unknown;
  let upper: unknown;
  let lowerInclusive = true;
  let upperInclusive = true;
  const between = timeFilters.length === 1 ? timeFilters[0] : undefined;
  if (between?.operator === 'between' && Array.isArray(between.value) && between.value.length === 2) {
    [lower, upper] = between.value;
  } else if (timeFilters.length === 2) {
    const start = timeFilters.find(filter => filter.operator === 'gt' || filter.operator === 'gte');
    const end = timeFilters.find(filter => filter.operator === 'lt' || filter.operator === 'lte');
    lower = start?.value;
    upper = end?.value;
    lowerInclusive = start?.operator === 'gte';
    upperInclusive = end?.operator === 'lte';
  }
  const start = parseTimeBound(lower);
  const end = parseTimeBound(upper);
  if (!start || !end) return undefined;
  return {
    start, end, lowerInclusive, upperInclusive,
    filters: filters.filter(filter => !timeFilters.includes(filter)),
  };
}

/** Mixed offset/local bounds cannot be ordered until the column timezone is known. */
export function isDefinitelyEmptyTimeRange(range: TimeAxisRange): boolean {
  const { start, end, lowerInclusive, upperInclusive } = range;
  if (start.hasOffset !== end.hasOffset) return false;
  return start.nanoseconds > end.nanoseconds
    || (start.nanoseconds === end.nanoseconds && !(lowerInclusive && upperInclusive));
}
