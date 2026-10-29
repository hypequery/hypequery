/**
 * Shared constants for semantic layer implementation.
 */

import type { DatasetHavingOperator, MetricFilter, MetricNullCheckOperator, TimeGrain } from './types.js';

/**
 * Maps time grain to ClickHouse date truncation functions.
 *
 * @deprecated Grain SQL is engine-specific and now rendered by the datasets
 * SQL dialect; use {@link SUPPORTED_TIME_GRAINS} to enumerate grains. Kept
 * for compatibility and no longer read by the planner.
 */
export const GRAIN_FUNCTIONS: Record<TimeGrain, string> = {
  minute: 'toStartOfMinute',
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
};

/** The set of time grains supported by the planner, finest first. */
export const SUPPORTED_TIME_GRAINS: TimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];

/**
 * The filter operators accepted by semantic dataset and metric inputs, and the
 * operators a filter allows when its definition lists none. The null checks in
 * {@link SEMANTIC_NULL_CHECK_OPERATORS} are accepted too, but a caller filter
 * may use one only when its definition lists it (RFC 0023).
 */
export const SEMANTIC_FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'between',
  'like',
] as const satisfies readonly MetricFilter['operator'][];

/**
 * Operators that test a field for NULL and take no value (RFC 0023). Measure
 * and segment filters may use them freely; a caller filter only when its
 * definition's `operators` list names them.
 */
export const SEMANTIC_NULL_CHECK_OPERATORS = [
  'isNull',
  'isNotNull',
] as const satisfies readonly MetricNullCheckOperator[];

const FILTER_OPERATORS: ReadonlySet<string> = new Set([...SEMANTIC_FILTER_OPERATORS, ...SEMANTIC_NULL_CHECK_OPERATORS]);

/** True for `isNull` and `isNotNull`, the filter operators without a value. */
export function isNullCheckFilterOperator(operator: unknown): operator is MetricNullCheckOperator {
  return operator === 'isNull' || operator === 'isNotNull';
}

/**
 * Narrowing guard for a runtime-provided filter operator. Query builders accept
 * operators that splice raw SQL (`inSubquery`, `inTable`), so anything outside
 * the semantic set must never reach one.
 */
export function isSemanticFilterOperator(operator: unknown): operator is MetricFilter['operator'] {
  return typeof operator === 'string' && FILTER_OPERATORS.has(operator);
}

/**
 * Operators accepted by dataset `having` conditions. `like` is excluded:
 * conditions compare aggregated numeric values.
 */
export const SEMANTIC_HAVING_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'between',
] as const satisfies readonly DatasetHavingOperator[];

/**
 * Narrowing guard for a runtime-provided grain value.
 */
export function isSupportedTimeGrain(grain: unknown): grain is TimeGrain {
  return typeof grain === 'string' && (SUPPORTED_TIME_GRAINS as readonly string[]).includes(grain);
}
