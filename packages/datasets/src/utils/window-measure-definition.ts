import type { WindowMeasureDefinition } from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

export type WindowMeasureOptions = Pick<WindowMeasureDefinition,
  'label' | 'description' | 'examples' | 'synonyms' | 'format' | 'unit' | 'currency' | 'timezone' | 'sensitivity'>;

export function createWindowMeasure<const TMeasureName extends string>(
  baseMeasure: TMeasureName,
  window: Pick<WindowMeasureDefinition, 'trailing' | 'toDate' | 'cumulative'>,
  options?: WindowMeasureOptions,
): WindowMeasureDefinition<TMeasureName> {
  return {
    __type: 'window_measure_definition',
    measure: baseMeasure,
    ...window,
    ...snapshotSemanticMetadata(options ?? {}),
    ...(options?.label === undefined ? {} : { label: options.label }),
    ...(options?.description === undefined ? {} : { description: options.description }),
  } as WindowMeasureDefinition<TMeasureName>;
}
