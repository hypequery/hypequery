import type { AnyDatasetInstance, DatasetQuery, WindowMeasureDefinition } from '../types.js';
import { getDerivedMeasure, isWindowMeasure } from './dataset-measures.js';

/** Windows selected directly or needed by a selected formula. */
export function selectedWindowMeasures(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
): Map<string, WindowMeasureDefinition> {
  const names = new Set(query.measures ?? []);
  for (const name of query.measures ?? []) {
    const derived = getDerivedMeasure(dataset.measures, name);
    if (derived) Object.values(derived.uses).forEach(input => names.add(input));
  }
  const windows = new Map<string, WindowMeasureDefinition>();
  for (const name of names) {
    const definition = Object.hasOwn(dataset.measures, name) ? dataset.measures[name] : undefined;
    if (isWindowMeasure(definition)) windows.set(name, definition);
  }
  return windows;
}
