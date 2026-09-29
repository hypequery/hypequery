import type { DatasetMeasureDefinition, MeasureDefinition } from '../types.js';
import { isBaseMeasure, isDerivedMeasure, isShiftMeasure, isWindowMeasure } from './dataset-measures.js';

export function measureDependencies(definition: DatasetMeasureDefinition): string[] {
  if (isDerivedMeasure(definition)) return Object.values(definition.uses);
  if (isShiftMeasure(definition) || isWindowMeasure(definition)) return [definition.measure];
  return [];
}

/** Dependency order, with each shared input visited once. */
export function measureDependencyNames(measures: Readonly<Record<string, DatasetMeasureDefinition>>, selected: readonly string[]): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const names: string[] = [];
  const visit = (name: string): void => {
    if (visiting.has(name)) throw new Error(`Measure "${name}" contains a dependency cycle.`);
    if (visited.has(name) || !Object.hasOwn(measures, name)) return;
    visiting.add(name);
    measureDependencies(measures[name]).forEach(visit);
    visiting.delete(name);
    visited.add(name);
    names.push(name);
  };
  selected.forEach(visit);
  return names;
}

export function assertMeasureDependenciesAcyclic(dataset: string, measures: Readonly<Record<string, DatasetMeasureDefinition>>): void {
  try { measureDependencyNames(measures, Object.keys(measures)); }
  catch (error) { throw new Error(`Invalid dataset "${dataset}": ${String(error)}`); }
}

/** Wrappers inherit aggregation metadata only when their input has one. */
export function inheritedBaseMeasure(measures: Readonly<Record<string, DatasetMeasureDefinition>>, name: string): MeasureDefinition | undefined {
  const definition = measures[name];
  if (isBaseMeasure(definition)) return definition;
  if (isWindowMeasure(definition) || isShiftMeasure(definition)) return inheritedBaseMeasure(measures, definition.measure);
  return undefined;
}
