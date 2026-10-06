/**
 * Shared constants for semantic layer implementation.
 */

import type { MetricFilter, TimeGrain } from './types.js';

/**
 * Maps time grain to ClickHouse date truncation functions.
 *
 * Weeks start on Monday (ISO 8601). `toMonday` is used rather than
 * `toStartOfWeek`, whose default mode starts weeks on Sunday.
 */
export const GRAIN_FUNCTIONS: Record<TimeGrain, string> = {
  minute: 'toStartOfMinute',
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
  week: 'toMonday',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
};

/**
 * The set of time grains supported by the planner. Derived from
 * {@link GRAIN_FUNCTIONS} so the two never drift apart.
 */
export const SUPPORTED_TIME_GRAINS = Object.keys(GRAIN_FUNCTIONS) as TimeGrain[];

/**
 * The filter operators accepted by semantic dataset and metric inputs.
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

const FILTER_OPERATORS: ReadonlySet<string> = new Set(SEMANTIC_FILTER_OPERATORS);

/**
 * Narrowing guard for a runtime-provided filter operator. Query builders accept
 * operators that splice raw SQL (`inSubquery`, `inTable`), so anything outside
 * the semantic set must never reach one.
 */
export function isSemanticFilterOperator(operator: unknown): operator is MetricFilter['operator'] {
  return typeof operator === 'string' && FILTER_OPERATORS.has(operator);
}

/**
 * Narrowing guard for a runtime-provided grain value.
 */
export function isSupportedTimeGrain(grain: unknown): grain is TimeGrain {
  return typeof grain === 'string' && Object.hasOwn(GRAIN_FUNCTIONS, grain);
}
