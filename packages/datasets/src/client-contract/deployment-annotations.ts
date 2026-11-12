import type {
  ClientEndpointAnnotations,
  ClientFieldAnnotation,
  ProtocolDeploymentDataset,
  ProtocolSemanticMetadata,
} from '@hypequery/protocol';

/** Fold whitespace runs so multi-line definitions stay advertisable; omit blank text. */
export function annotationText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const folded = value.split(/\s+/).filter(Boolean).join(' ');
  return folded.trim() ? folded : undefined;
}

/** Folded, non-blank, first-occurrence items; omitted when none remain. */
export function annotationList(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const items = [...new Set(values.flatMap(value => annotationText(value) ?? []))];
  return items.length ? items : undefined;
}

type AnnotatedDefinition = ProtocolSemanticMetadata & { readonly label?: string; readonly description?: string };

function fieldAnnotation(definition: AnnotatedDefinition, fieldMetadata: boolean): ClientFieldAnnotation | undefined {
  const node: Record<string, unknown> = {};
  const label = annotationText(definition.label);
  const description = annotationText(definition.description);
  if (label !== undefined) node.label = label;
  if (description !== undefined) node.description = description;
  if (fieldMetadata) {
    const synonyms = annotationList(definition.synonyms);
    const examples = annotationList(definition.examples);
    const format = annotationText(definition.format);
    const unit = annotationText(definition.unit);
    if (synonyms !== undefined) node.synonyms = synonyms;
    if (examples !== undefined) node.examples = examples;
    if (format !== undefined) node.format = format;
    if (unit !== undefined) node.unit = unit;
    if (definition.currency !== undefined) node.currency = definition.currency;
  }
  return Object.keys(node).length ? node as ClientFieldAnnotation : undefined;
}

/**
 * Group text from the dataset; field text for each advertised dimension and
 * measure. With `fieldMetadata`, fields also carry their synonyms, examples,
 * format, unit and currency.
 */
export function endpointAnnotations(
  dataset: ProtocolDeploymentDataset,
  dimensions: readonly string[],
  measures: readonly string[],
  fieldMetadata = false,
): ClientEndpointAnnotations | undefined {
  const advertised = [
    ...dataset.dimensions.filter(item => dimensions.includes(item.name)),
    ...dataset.measures.filter(item => measures.includes(item.name)),
  ];
  // Object.fromEntries defines each name as an own key, `__proto__` included.
  const fields: Record<string, ClientFieldAnnotation> = Object.fromEntries(advertised.flatMap(definition => {
    const node = fieldAnnotation(definition, fieldMetadata);
    return node ? [[definition.name, node]] : [];
  }));
  const description = annotationText(dataset.description);
  const result: ClientEndpointAnnotations = {
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}
