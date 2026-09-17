import type {
  BaseMeasures,
  DatasetMeasureDefinition,
  DerivedMeasureDefinition,
  DerivedMeasures,
  MeasureDefinition,
} from '../types.js';

export function isDerivedMeasure(
  definition: DatasetMeasureDefinition,
): definition is DerivedMeasureDefinition {
  return definition.__type === 'derived_measure_definition';
}

export function isBaseMeasure(
  definition: DatasetMeasureDefinition,
): definition is MeasureDefinition {
  return definition.__type === 'measure_definition';
}

export function baseMeasureNames(measures: Record<string, DatasetMeasureDefinition>): string[] {
  return Object.entries(measures)
    .filter(([, definition]) => isBaseMeasure(definition))
    .map(([name]) => name);
}

export function splitDatasetMeasures<TMeasures extends Record<string, DatasetMeasureDefinition>>(
  measures: TMeasures | undefined,
): { base: BaseMeasures<TMeasures>; derived: DerivedMeasures<TMeasures> } {
  const entries = Object.entries(measures ?? {});
  return {
    base: Object.fromEntries(entries.filter(([, definition]) => isBaseMeasure(definition))) as BaseMeasures<TMeasures>,
    derived: Object.fromEntries(entries.filter(([, definition]) => isDerivedMeasure(definition))) as DerivedMeasures<TMeasures>,
  };
}

export function getDerivedMeasure(
  measures: Record<string, DatasetMeasureDefinition>,
  name: string,
): DerivedMeasureDefinition | undefined {
  if (!Object.hasOwn(measures, name)) return undefined;
  const definition = measures[name];
  return isDerivedMeasure(definition) ? definition : undefined;
}
