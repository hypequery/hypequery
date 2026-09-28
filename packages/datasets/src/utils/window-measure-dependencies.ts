import type { DatasetMeasureDefinition, DerivedMeasureDefinition } from '../types.js';
import { isWindowMeasure } from './dataset-measures.js';

/** Whether a derived measure requires window planning to execute. */
export function usesWindowMeasure(
  definition: DerivedMeasureDefinition,
  measures: Readonly<Record<string, DatasetMeasureDefinition>>,
): boolean {
  return Object.values(definition.uses).some(name =>
    Object.hasOwn(measures, name) && isWindowMeasure(measures[name]),
  );
}
