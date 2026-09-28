import type { MeasureTimeInterval, ShiftMeasureDefinition } from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

export type ShiftMeasureOptions = Pick<ShiftMeasureDefinition,
  'label' | 'description' | 'examples' | 'synonyms' | 'format' | 'unit' | 'currency' | 'sensitivity'>;

export function createShiftMeasure<const TMeasureName extends string>(
  baseMeasure: TMeasureName,
  interval: MeasureTimeInterval,
  options?: ShiftMeasureOptions,
): ShiftMeasureDefinition<TMeasureName> {
  return {
    __type: 'shift_measure_definition', measure: baseMeasure, interval: { ...interval },
    ...snapshotSemanticMetadata(options ?? {}),
    ...(options?.label === undefined ? {} : { label: options.label }),
    ...(options?.description === undefined ? {} : { description: options.description }),
  };
}
