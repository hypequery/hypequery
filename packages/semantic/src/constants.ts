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
