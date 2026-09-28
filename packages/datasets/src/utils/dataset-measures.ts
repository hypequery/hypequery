import type {
  DatasetMeasureDefinition,
  DerivedMeasureDefinition,
  DerivedMeasures,
  MeasureDefinition,
  WindowMeasureDefinition,
  ShiftMeasureDefinition,
} from '../types.js';

export function isDerivedMeasure(
  definition: DatasetMeasureDefinition | null | undefined,
): definition is DerivedMeasureDefinition {
  return definition?.__type === 'derived_measure_definition';
}

export function isBaseMeasure(
  definition: DatasetMeasureDefinition | null | undefined,
): definition is MeasureDefinition {
  return definition?.__type === 'measure_definition';
}

export function isWindowMeasure(
  definition: DatasetMeasureDefinition | null | undefined,
): definition is WindowMeasureDefinition {
  return definition?.__type === 'window_measure_definition';
}

export function isShiftMeasure(definition: DatasetMeasureDefinition | null | undefined): definition is ShiftMeasureDefinition {
  return definition?.__type === 'shift_measure_definition';
}

export function baseMeasureNames(measures: Record<string, DatasetMeasureDefinition>): string[] {
  return Object.entries(measures)
    .filter(([, definition]) => isBaseMeasure(definition))
    .map(([name]) => name);
}

export function getBaseMeasure(
  measures: Record<string, DatasetMeasureDefinition>,
  name: string,
): MeasureDefinition | undefined {
  if (!Object.hasOwn(measures, name)) return undefined;
  const definition = measures[name];
  return isBaseMeasure(definition) ? definition : undefined;
}

export function splitDatasetMeasures(
  measures: Record<string, DatasetMeasureDefinition> | undefined,
): {
  base: Record<string, MeasureDefinition>;
  derived: Record<string, DerivedMeasureDefinition>;
  windows: Record<string, WindowMeasureDefinition>;
  shifts: Record<string, ShiftMeasureDefinition>;
} {
  const entries = Object.entries(measures ?? {});
  return {
    base: Object.fromEntries(entries.filter((entry): entry is [string, MeasureDefinition] => isBaseMeasure(entry[1]))),
    derived: Object.fromEntries(entries.filter((entry): entry is [string, DerivedMeasureDefinition] => isDerivedMeasure(entry[1]))),
    shifts: Object.fromEntries(entries.filter((entry): entry is [string, ShiftMeasureDefinition] => isShiftMeasure(entry[1]))),
    windows: Object.fromEntries(entries.filter((entry): entry is [string, WindowMeasureDefinition] => isWindowMeasure(entry[1]))),
  };
}

/** Preserve the literal keys and formula aliases of the deprecated typed view. */
export function derivedMeasuresView<TMeasures extends Record<string, DatasetMeasureDefinition>>(
  measures: TMeasures,
): DerivedMeasures<TMeasures> {
  // TypeScript narrows each entry's value, but cannot reconstruct the mapped
  // subset of generic keys after Object.fromEntries. The filtering above
  // establishes that correspondence; preserve it at this single boundary.
  return splitDatasetMeasures(measures).derived as DerivedMeasures<TMeasures>;
}

export function getDerivedMeasure(
  measures: Record<string, DatasetMeasureDefinition>,
  name: string,
): DerivedMeasureDefinition | undefined {
  if (!Object.hasOwn(measures, name)) return undefined;
  const definition = measures[name];
  return isDerivedMeasure(definition) ? definition : undefined;
}
