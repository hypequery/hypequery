import type { MeasureDefinition } from '../types.js';
import { isCountStateMerge } from './aggregate-state-functions.js';

/** Counts are 0, not NULL, over an empty population. */
export function isCountAggregation(definition: MeasureDefinition): boolean {
  return ['count', 'countDistinct', 'approxCountDistinct'].includes(definition.aggregation)
    || isCountStateMerge(definition);
}
