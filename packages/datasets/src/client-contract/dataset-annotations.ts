import type { ClientEndpointAnnotations, ClientFieldAnnotation } from '@hypequery/protocol';
import type { AnyDatasetInstance } from '../types.js';
import { annotationText } from './deployment-annotations.js';

interface Described {
  readonly label?: string;
  readonly description?: string;
}

function fieldAnnotation(definition: Described | undefined): ClientFieldAnnotation | undefined {
  if (definition === undefined) return undefined;
  const label = annotationText(definition.label);
  const description = annotationText(definition.description);
  if (label === undefined && description === undefined) return undefined;
  return { ...(label !== undefined ? { label } : {}), ...(description !== undefined ? { description } : {}) };
}

/**
 * Group text from the dataset; field text for each advertised dimension and
 * measure. A metric endpoint's sole measure key is its public alias, so its
 * text comes from `metric`, the handle it serves.
 */
export function datasetEndpointAnnotations(
  dataset: AnyDatasetInstance,
  dimensions: readonly string[],
  measures: readonly string[],
  metric?: Described,
): ClientEndpointAnnotations | undefined {
  const fields: Record<string, ClientFieldAnnotation> = Object.fromEntries([
    ...dimensions.map(key => [key, fieldAnnotation(dataset.dimensions[key])] as const),
    ...measures.map(key => [key, fieldAnnotation(metric ?? dataset.measures[key])] as const),
  ].filter((entry): entry is readonly [string, ClientFieldAnnotation] => entry[1] !== undefined));
  const description = annotationText(dataset.description);
  const result: ClientEndpointAnnotations = {
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}
