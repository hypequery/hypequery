import { measureDependencyNames } from './measure-dependencies.js';
import { getBaseMeasure } from './dataset-measures.js';
/**
 * Which measures return estimates. Catalogs mark them `approximate` so a
 * consumer, and in particular an agent, can say a value is an estimate
 * (RFC 0015).
 */

import type { AggregationType, DerivedMeasureDefinition, DatasetMeasureDefinition } from '../types.js';

export function isApproximateAggregation(aggregation: AggregationType): boolean {
  return aggregation === 'approxCountDistinct';
}

/** A derived measure is approximate when any measure it uses is. */
export function isApproximateDerivedMeasure(
  measures: Readonly<Record<string, DatasetMeasureDefinition>>,
  definition: DerivedMeasureDefinition,
): boolean {
  return measureDependencyNames(measures, Object.values(definition.uses)).some(name => {
    const base = getBaseMeasure(measures, name);
    return base !== undefined && isApproximateAggregation(base.aggregation);
  });
}

export function isApproximateMeasure(measures: Readonly<Record<string, DatasetMeasureDefinition>>, name: string): boolean {
  return measureDependencyNames(measures, [name]).some(input => {
    const base = getBaseMeasure(measures, input);
    return base !== undefined && isApproximateAggregation(base.aggregation);
  });
}
