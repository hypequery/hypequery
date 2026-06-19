/**
 * Shared constants for semantic layer implementation.
 */

import type { TimeGrain } from './types.js';

/**
 * Maps time grain to ClickHouse date truncation functions.
 */
export const GRAIN_FUNCTIONS: Record<TimeGrain, string> = {
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
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
 * Narrowing guard for a runtime-provided grain value.
 */
export function isSupportedTimeGrain(grain: unknown): grain is TimeGrain {
  return typeof grain === 'string' && Object.hasOwn(GRAIN_FUNCTIONS, grain);
}
