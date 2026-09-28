import type { DatasetMeasureDefinition, TimeGrain } from '../types.js';
import { getDerivedMeasure, isShiftMeasure, isWindowMeasure } from './dataset-measures.js';
import { windowGrainErrors } from './time-axis-intervals.js';
import { supportsShiftGrain } from './shift-measure-grains.js';

/** Intersect time-measure requirements with the dataset's declared grains. */
export function measureSupportedGrains(
  measures: Readonly<Record<string, DatasetMeasureDefinition>>, name: string, grains: readonly TimeGrain[],
): TimeGrain[] {
  const definition = measures[name];
  if (isShiftMeasure(definition)) {
    return grains.filter(grain => supportsShiftGrain(definition.interval, grain));
  }
  if (isWindowMeasure(definition)) return grains.filter(grain => !windowGrainErrors(name, definition, grain).length);
  const derived = getDerivedMeasure(measures, name);
  if (!derived) return [...grains];
  const inputs = Object.values(derived.uses).map(input => measureSupportedGrains(measures, input, grains));
  return grains.filter(grain => inputs.every(supported => supported.includes(grain)));
}
