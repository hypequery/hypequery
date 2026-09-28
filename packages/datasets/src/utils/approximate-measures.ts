import { getBaseMeasure, isWindowMeasure } from './dataset-measures.js';
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
  return Object.values(definition.uses).some(name => {
    const measure = Object.hasOwn(measures, name) ? measures[name] : undefined;
    const base = isWindowMeasure(measure) ? getBaseMeasure(measures, measure.measure) : getBaseMeasure(measures, name);
    return base !== undefined && isApproximateAggregation(base.aggregation);
  });
}
