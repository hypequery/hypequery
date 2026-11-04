import type { ClientDimension, ClientFilter, ClientMeasure } from '@hypequery/protocol';
import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import type {
  AnyDatasetInstance,
  DatasetMeasureDefinition,
  DimensionDefinition,
  SemanticFilterDefinition,
} from '../types.js';
import { isBaseMeasure, isDerivedMeasure } from '../utils/dataset-measures.js';

// As Python's builder: booleans compare by equality and membership only.
const BOOLEAN_OPERATORS = new Set(['eq', 'neq', 'in', 'notIn']);
const ORDERED_AGGREGATIONS = new Set(['min', 'max', 'argMin', 'argMax']);
/** Stored states whose merged value is the stored value itself, which may not be a number. */
const ORDERED_STATES = new Set(['min', 'max', 'any', 'anyLast']);

/** Local fields have unknown nullability; the client contract says so rather than guess. */
export function datasetDimensionDescriptor(dimension: DimensionDefinition): ClientDimension {
  const type = dimension.fieldType;
  return {
    type,
    wireType: type === 'number' ? 'number-or-string' : type === 'boolean' ? 'boolean' : 'string',
    nullable: 'unknown',
    groupable: dimension.groupable !== false,
    orderable: dimension.groupable !== false,
  };
}

/**
 * Base and derived measures are served by a plain query. Window and shift
 * measures need a time axis the client profile does not carry, so they, and
 * formulas over them, are not advertised.
 */
export function servableMeasure(dataset: AnyDatasetInstance, name: string, path = new Set<string>()): boolean {
  // `path` holds only the current chain, so a measure used twice is not a cycle.
  if (!Object.hasOwn(dataset.measures, name) || path.has(name)) return false;
  const measure = dataset.measures[name];
  if (isBaseMeasure(measure)) return true;
  if (!isDerivedMeasure(measure)) return false;
  path.add(name);
  const servable = Object.values(measure.uses).every(use => servableMeasure(dataset, use, path));
  path.delete(name);
  return servable;
}

/** `having` compares numbers, so ordered aggregations over non-numeric fields can't take it. */
export function datasetMeasureDescriptor(dataset: AnyDatasetInstance, measure: DatasetMeasureDefinition): ClientMeasure {
  if (!isBaseMeasure(measure)) return { wireType: 'string', nullable: true, having: true };
  if (measure.aggregation === 'merge') {
    return { wireType: 'string', nullable: true, having: !ORDERED_STATES.has(String(measure.stateFunction)) };
  }
  if (!ORDERED_AGGREGATIONS.has(measure.aggregation)) return { wireType: 'string', nullable: true, having: true };
  const dimension = Object.hasOwn(dataset.dimensions, measure.field) ? dataset.dimensions[measure.field] : undefined;
  return { wireType: 'string', nullable: true, having: dimension?.fieldType === 'number' };
}

export function datasetFilterDescriptor(dimension: DimensionDefinition, filter: SemanticFilterDefinition): ClientFilter | null {
  const type = dimension.fieldType;
  // An undeclared list allows every value operator; null checks must be named (RFC 0023).
  const operators = [...new Set((filter.operators ?? SEMANTIC_FILTER_OPERATORS).filter(operator => type === 'boolean'
    ? BOOLEAN_OPERATORS.has(operator)
    : type !== 'number' || operator !== 'like'))].sort();
  return operators.length ? { type, operators } : null;
}

/** Tenant identities come from the caller's credential, never from request predicates. */
function requestFilter(dataset: AnyDatasetInstance, field: string): boolean {
  return dataset.tenantKey === undefined || (dataset.dimensions[field].column ?? field) !== dataset.tenantKey;
}

/** The fields a measure's fixed filters read, through any derived dependencies. */
function measureFilterFields(dataset: AnyDatasetInstance, name: string): string[] {
  const pending = [name];
  const seen = new Set<string>();
  const fields: string[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current) || !Object.hasOwn(dataset.measures, current)) continue;
    seen.add(current);
    const measure = dataset.measures[current];
    if (isDerivedMeasure(measure)) pending.push(...Object.values(measure.uses));
    else if (isBaseMeasure(measure)) {
      for (const filter of measure.filters ?? []) {
        fields.push(Object.hasOwn(dataset.filters, filter.field) ? dataset.filters[filter.field].field : filter.field);
      }
    }
  }
  return fields;
}

/**
 * The fields one dataset endpoint advertises, resolved from the definition as
 * Python's `public_fields` does with `related=()`. Relationship fields are not
 * exported yet, so a measure whose fixed filters cross a relationship is left out.
 */
export function datasetPublicFields(dataset: AnyDatasetInstance): {
  dimensions: Record<string, ClientDimension>;
  measures: Record<string, ClientMeasure>;
  filters: Record<string, ClientFilter>;
} {
  // Object.fromEntries defines each name as an own key, `__proto__` included.
  const dimensions = Object.fromEntries(Object.entries(dataset.dimensions)
    .map(([name, dimension]) => [name, datasetDimensionDescriptor(dimension)]));
  const measures = Object.fromEntries(Object.entries(dataset.measures)
    .filter(([name]) => servableMeasure(dataset, name)
      && measureFilterFields(dataset, name).every(field => !field.includes('.')))
    .map(([name, measure]) => [name, datasetMeasureDescriptor(dataset, measure)]));
  const filters = Object.fromEntries(Object.entries(dataset.filters).flatMap(([name, filter]): [string, ClientFilter][] => {
    if (filter.field.includes('.')) return [];
    if (!Object.hasOwn(dataset.dimensions, filter.field)) {
      throw new Error(`Client export: filter "${dataset.name}.${name}" references unknown dimension "${filter.field}".`);
    }
    if (!requestFilter(dataset, filter.field)) return [];
    const descriptor = datasetFilterDescriptor(dataset.dimensions[filter.field], filter);
    return descriptor ? [[name, descriptor]] : [];
  }));
  return { dimensions, measures, filters };
}
