import { measureDependencyNames } from './measure-dependencies.js';
import type { AnyDatasetInstance, DatasetQuery, ShiftMeasureDefinition, WindowMeasureDefinition, DerivedMeasureDefinition, DatasetMeasureDefinition } from '../types.js';
import { isShiftMeasure, isWindowMeasure } from './dataset-measures.js';

export type TimeMeasureDefinition = WindowMeasureDefinition | ShiftMeasureDefinition;

export function selectedTimeMeasures(dataset: AnyDatasetInstance, query: DatasetQuery): Map<string, TimeMeasureDefinition> {
  const names = measureDependencyNames(dataset.measures, query.measures ?? []);
  const measures = new Map<string, TimeMeasureDefinition>();
  for (const name of names) {
    const definition = Object.hasOwn(dataset.measures, name) ? dataset.measures[name] : undefined;
    if (isWindowMeasure(definition) || isShiftMeasure(definition)) measures.set(name, definition);
  }
  return measures;
}

export function usesTimeMeasure(definition: DerivedMeasureDefinition, measures: Readonly<Record<string, DatasetMeasureDefinition>>): boolean {
  return measureDependencyNames(measures, Object.values(definition.uses)).some(name => isWindowMeasure(measures[name]) || isShiftMeasure(measures[name]));
}

export function rejectTimeMeasuresOnBackend(dataset: AnyDatasetInstance, query: DatasetQuery): void {
  const measures = [...selectedTimeMeasures(dataset, query).values()];
  if (!measures.length) return;
  const windows = measures.some(isWindowMeasure);
  const shifts = measures.some(isShiftMeasure);
  const subject = windows && shifts ? 'Window and shift' : shifts ? 'Shift' : 'Window';
  throw new Error(`${subject} dataset measures require the queryBuilder execution path.`);
}
