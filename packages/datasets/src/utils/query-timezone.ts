import type { AnyDatasetInstance } from '../types.js';

/** Named zones only: reject fixed offsets, invalid zones, and SQL fragments. */
export function isQueryTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100
    || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function queryTimezoneErrors(timezone: unknown): string[] {
  return timezone === undefined || isQueryTimezone(timezone)
    ? [] : ['Invalid timezone: use an IANA name such as UTC or America/New_York.'];
}

/** Conversion preserves timestamp instants and interprets Date values as local dates. */
export function queryTimeSql(expression: string, timezone: string | undefined): string {
  timezone ??= 'UTC';
  const errors = queryTimezoneErrors(timezone);
  if (errors.length) throw new Error(errors[0]);
  const name = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
  return `toDateTime64(${expression}, 9, '${name}')`;
}

/** Apply the query zone to time-key predicates, including semantic filter aliases. */
export function queryTimeFilterSql(
  ds: AnyDatasetInstance, field: string, expression: string, timezone: string | undefined,
): string {
  if (!ds.timeKey || field.includes('.')) return expression;
  const resolved = ds.filters[field]?.field ?? field;
  const column = ds.dimensions[resolved]?.column ?? resolved;
  const timeColumn = ds.dimensions[ds.timeKey]?.column ?? ds.timeKey;
  return column === timeColumn ? queryTimeSql(expression, timezone) : expression;
}
