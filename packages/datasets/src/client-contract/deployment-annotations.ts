import type {
  ClientEndpointAnnotations,
  ClientFieldAnnotation,
  ProtocolDeploymentDataset,
} from '@hypequery/protocol';

/** Fold whitespace runs so multi-line definitions stay advertisable; omit blank text. */
export function annotationText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const folded = value.split(/\s+/).filter(Boolean).join(' ');
  return folded.trim() ? folded : undefined;
}

function fieldAnnotation(definition: { readonly label?: string; readonly description?: string }): ClientFieldAnnotation | undefined {
  const label = annotationText(definition.label);
  const description = annotationText(definition.description);
  if (label === undefined && description === undefined) return undefined;
  return { ...(label !== undefined ? { label } : {}), ...(description !== undefined ? { description } : {}) };
}

/** Group text from the dataset; field text for each advertised dimension and measure. */
export function endpointAnnotations(
  dataset: ProtocolDeploymentDataset,
  dimensions: readonly string[],
  measures: readonly string[],
): ClientEndpointAnnotations | undefined {
  const advertised = [
    ...dataset.dimensions.filter(item => dimensions.includes(item.name)),
    ...dataset.measures.filter(item => measures.includes(item.name)),
  ];
  // Object.fromEntries defines each name as an own key, `__proto__` included.
  const fields: Record<string, ClientFieldAnnotation> = Object.fromEntries(advertised.flatMap(definition => {
    const node = fieldAnnotation(definition);
    return node ? [[definition.name, node]] : [];
  }));
  const description = annotationText(dataset.description);
  const result: ClientEndpointAnnotations = {
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}
