import type { RegistryEntry } from './types';

/**
 * Parses the JSON Schema (`inputSchema`) of a semantic dataset endpoint from
 * GET /registry into picker-ready field lists. Serve enumerates dimension /
 * measure / filter-field names in the schema (see serve's
 * semantic-input-schema); where a list would have been empty serve falls back
 * to a plain string, which we surface as an empty list so the UI can render a
 * free-text input instead of an empty picker.
 */
export interface DatasetQueryShape {
  dimensions: string[];
  measures: string[];
  filterFields: string[];
  operators: string[];
  grains: string[];
  maxLimit?: number;
}

interface JsonSchemaNode {
  type?: string;
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  maxItems?: number;
  maximum?: number;
}

function enumOf(node: JsonSchemaNode | undefined): string[] {
  const values = node?.enum;
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

/** A dataset endpoint as registered by serve (key `dataset:<name>`). */
export function isDatasetEntry(entry: RegistryEntry): boolean {
  return entry.tags.includes('datasets') && entry.key.startsWith('dataset:');
}

/** Human name of a dataset entry ("dataset:orders" → "orders"). */
export function datasetLabel(entry: RegistryEntry): string {
  return entry.name ?? entry.key.replace(/^dataset:/, '');
}

export function parseDatasetQueryShape(entry: RegistryEntry): DatasetQueryShape {
  const schema = (entry.inputSchema ?? {}) as JsonSchemaNode;
  const props = schema.properties ?? {};

  const filterProps = props.filters?.items?.properties ?? {};

  return {
    dimensions: enumOf(props.dimensions?.items),
    measures: enumOf(props.measures?.items),
    filterFields: enumOf(filterProps.field),
    operators: enumOf(filterProps.operator),
    grains: enumOf(props.by),
    maxLimit: props.limit?.maximum,
  };
}
