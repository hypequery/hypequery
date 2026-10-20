import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { AnyDatasetInstance, MetricFilter } from '../types.js';
import { resolveFilterFieldType } from './filter-field-type.js';
import { instantWallClock, parseTimestampInstant } from './timestamp-instants.js';

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

function canonicalTimezone(timezone: string | undefined): string {
  timezone ??= 'UTC';
  const errors = queryTimezoneErrors(timezone);
  if (errors.length) throw new Error(errors[0]);
  return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
}

/** Conversion preserves timestamp instants and interprets Date values as local dates. */
export function queryTimeSql(dialect: DatasetSqlDialectRules, expression: string, timezone: string | undefined): string {
  return dialect.toQueryTimezone(expression, canonicalTimezone(timezone));
}

/** True when a local filter field reads the dataset's time-key column. */
export function isTimeKeyFilter(ds: AnyDatasetInstance, field: string): boolean {
  if (!ds.timeKey || field.includes('.')) return false;
  const resolved = ds.filters[field]?.field ?? field;
  const column = ds.dimensions[resolved]?.column ?? resolved;
  const timeColumn = ds.dimensions[ds.timeKey]?.column ?? ds.timeKey;
  return column === timeColumn;
}

/** Apply the query zone to time-key predicates, including semantic filter aliases. */
export function queryTimeFilterSql(
  dialect: DatasetSqlDialectRules,
  ds: AnyDatasetInstance, field: string, expression: string, timezone: string | undefined,
): string {
  return isTimeKeyFilter(ds, field) ? queryTimeSql(dialect, expression, timezone) : expression;
}

export interface QueryTimeFilterPredicate {
  /** The column side of the predicate, converted to a zone when the value needs one. */
  readonly expression: string;
  /** The value to bind, with instants rewritten to the wall clock of that zone. */
  readonly value: unknown;
}

export interface QueryTimeFilterOptions {
  /**
   * Convert a time-key column to the query zone even for offset-free values,
   * so they read as local time there. Default true; caller filters opt in,
   * author-defined segment filters keep the column's own zone.
   */
  readonly timeKeyInQueryZone?: boolean;
}

/**
 * The predicate for one filter under the query zone.
 *
 * A timestamp value carrying `Z` or an offset is an instant, which ClickHouse
 * cannot read as a DateTime64 literal. Such a value is rewritten to the wall
 * clock it shows in the zone the column is converted to, which keeps the
 * comparison exact: a predicate whose values are all instants compares in
 * UTC, where no wall clock is ambiguous; one that mixes instants with
 * offset-free values keeps the query zone, so the local values still read
 * there. Offset-free values and non-timestamp fields are bound unchanged.
 */
export function queryTimeFilter(
  dialect: DatasetSqlDialectRules,
  ds: AnyDatasetInstance,
  filter: MetricFilter,
  expression: string,
  timezone: string | undefined,
  options: QueryTimeFilterOptions = {},
): QueryTimeFilterPredicate {
  const timeKey = options.timeKeyInQueryZone !== false && isTimeKeyFilter(ds, filter.field);
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  // A `like` pattern is text, never a point in time.
  const instants = filter.operator !== 'like' && resolveFilterFieldType(ds, filter.field) === 'timestamp'
    ? values.map(parseTimestampInstant)
    : [];
  if (!instants.some(Boolean)) {
    return { expression: timeKey ? queryTimeSql(dialect, expression, timezone) : expression, value: filter.value };
  }
  const zone = instants.every(Boolean) ? 'UTC' : canonicalTimezone(timezone);
  const rewritten = values.map((value, index) => {
    const instant = instants[index];
    return instant ? instantWallClock(instant, zone) : value;
  });
  return {
    expression: dialect.toQueryTimezone(expression, zone),
    value: Array.isArray(filter.value) ? rewritten : rewritten[0],
  };
}
