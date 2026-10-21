import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { AnyDatasetInstance, MetricFilter, MetricFilterOperator } from '../types.js';
import { resolveDimensionFieldType, resolveFilterFieldType } from './filter-field-type.js';
import { instantWallClock, parseTimestampInstant } from './timestamp-instants.js';
import { mixedInstantListError } from '../validation.js';

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

/** One `where` call: the column side, its operator, and the value to bind. */
export interface QueryTimePredicate {
  /** The column side of the predicate, converted to a zone when the value needs one. */
  readonly expression: string;
  readonly operator: MetricFilterOperator;
  /** The value to bind, with instants rewritten to the wall clock of that zone. */
  readonly value: unknown;
}

export interface QueryTimeFilterOptions {
  /**
   * How `filter.field` names its dimension. Caller filters (`'filter'`, the
   * default) go through the dataset's filter aliases and read the time key in
   * the query zone. Segment filters (`'dimension'`) name a dimension directly
   * and keep the column's own zone for offset-free values.
   */
  readonly field?: 'filter' | 'dimension';
}

const INSTANT_ZONE = 'UTC';

/**
 * The `where` predicates for one filter under the query zone.
 *
 * A timestamp value carrying `Z` or an offset is an instant, which ClickHouse
 * cannot read as a DateTime64 literal. Such a value is rewritten to its UTC
 * wall clock and compared against the column converted to UTC, where no wall
 * clock is ambiguous, so the comparison stays exact in every query zone.
 * Offset-free values keep the predicate they had: the query zone for a
 * caller filter on the time key, the column's own zone otherwise.
 *
 * A range or exclusion list mixing both kinds splits into one predicate per
 * kind, so an instant bound never loses its offset to a local one. A mixed
 * `in` list cannot split (its members are alternatives, and predicates only
 * combine with AND), so it is rejected rather than read in one zone that
 * changes a member's meaning. Non-timestamp fields and `like` patterns are
 * bound unchanged.
 */
export function queryTimeFilter(
  dialect: DatasetSqlDialectRules,
  ds: AnyDatasetInstance,
  filter: MetricFilter,
  expression: string,
  timezone: string | undefined,
  options: QueryTimeFilterOptions = {},
): QueryTimePredicate[] {
  const callerFilter = options.field !== 'dimension';
  const fieldType = callerFilter
    ? resolveFilterFieldType(ds, filter.field)
    : resolveDimensionFieldType(ds, filter.field);
  const localExpression = callerFilter && isTimeKeyFilter(ds, filter.field)
    ? queryTimeSql(dialect, expression, timezone)
    : expression;
  const local: QueryTimePredicate = { expression: localExpression, operator: filter.operator, value: filter.value };
  if (fieldType !== 'timestamp' || filter.operator === 'like') return [local];

  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const instants = values.map(parseTimestampInstant);
  if (!instants.some(Boolean)) return [local];

  const instantExpression = dialect.toQueryTimezone(expression, INSTANT_ZONE);
  const rewrite = (zone: string) => values.map((value, index) => {
    const instant = instants[index];
    return instant ? instantWallClock(instant, zone) : value;
  });
  if (instants.every(Boolean)) {
    const rewritten = rewrite(INSTANT_ZONE);
    return [{ expression: instantExpression, operator: filter.operator, value: Array.isArray(filter.value) ? rewritten : rewritten[0] }];
  }

  switch (filter.operator) {
    case 'between': {
      const bound = (index: number, operator: MetricFilterOperator): QueryTimePredicate => instants[index]
        ? { expression: instantExpression, operator, value: instantWallClock(instants[index]!, INSTANT_ZONE) }
        : { expression: localExpression, operator, value: values[index] };
      return [bound(0, 'gte'), bound(1, 'lte')];
    }
    case 'notIn':
      return [
        { expression: localExpression, operator: 'notIn', value: values.filter((_, index) => !instants[index]) },
        { expression: instantExpression, operator: 'notIn', value: rewrite(INSTANT_ZONE).filter((_, index) => instants[index]) },
      ];
    default:
      throw new Error(mixedInstantListError(filter.field));
  }
}
