/**
 * The time grains a dataset supports: none without a `timeKey`, otherwise its
 * declared `timeGrains`, or every grain the planner can bucket on.
 */

import { SUPPORTED_TIME_GRAINS } from '../constants.js';
import type { TimeGrain } from '../types.js';

export function datasetTimeGrains(
  dataset: { readonly timeKey?: string; readonly timeGrains?: readonly TimeGrain[] },
): readonly TimeGrain[] {
  if (!dataset.timeKey) return [];
  return dataset.timeGrains ?? SUPPORTED_TIME_GRAINS;
}

/** Validation message for a grain the dataset does not support, or undefined. */
export function unsupportedTimeGrainError(
  dataset: { readonly timeKey?: string; readonly timeGrains?: readonly TimeGrain[] },
  grain: unknown,
): string | undefined {
  const supported = datasetTimeGrains(dataset);
  if (typeof grain === 'string' && supported.includes(grain as TimeGrain)) return undefined;
  return `Unsupported time grain "${String(grain)}". Supported: ${supported.join(', ')}`;
}
