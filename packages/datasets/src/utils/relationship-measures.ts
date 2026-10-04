import type { AnyDatasetInstance, MeasureDefinition, RelationshipDefinition } from '../types.js';
import { isBaseMeasure } from './dataset-measures.js';
import { parseQualifiedField, resolveQualifiedField } from './relationship-fields.js';

const DUPLICATE_INSENSITIVE = new Set(['countDistinct', 'approxCountDistinct', 'min', 'max', 'argMax', 'argMin']);

export interface ResolvedRelationshipMeasure {
  relationshipName: string;
  relationship: RelationshipDefinition;
  target: AnyDatasetInstance;
  definition: MeasureDefinition;
}

/** Resolve only the one-hop, duplicate-safe aggregate vocabulary of RFC 0015. */
export function resolveRelationshipMeasure(ds: AnyDatasetInstance, name: string): ResolvedRelationshipMeasure {
  const parsed = parseQualifiedField(name);
  if (!parsed || parsed.field.includes('.')) throw new Error(`Measure "${name}" must use a one-hop relationship path.`);
  const relationship = Object.hasOwn(ds.relationships, parsed.relationship) ? ds.relationships[parsed.relationship] : undefined;
  if (!relationship) throw new Error(`Unknown relationship "${parsed.relationship}" in measure "${name}".`);
  if (relationship.kind === 'hasMany') throw new Error(`Measure "${name}" cannot traverse hasMany: it would fan out aggregates.`);
  const target = relationship.target() as AnyDatasetInstance;
  const definition = Object.hasOwn(target.measures, parsed.field) ? target.measures[parsed.field] : undefined;
  if (!definition) throw new Error(`Unknown measure "${parsed.field}" on relationship target "${target.name}".`);
  if (!isBaseMeasure(definition)) throw new Error(`Measure "${name}" must reference a base aggregate; derived, window, and shift measures are not selectable through relationships.`);
  if (relationship.kind === 'belongsTo' && !DUPLICATE_INSENSITIVE.has(definition.aggregation)) {
    throw new Error(`Measure "${name}" cannot use ${definition.aggregation} through belongsTo: repeated target rows would inflate the aggregation. Use a duplicate-insensitive measure or query the target dataset.`);
  }
  const referenced = [definition.field, definition.argField, ...(definition.filters ?? []).map(filter => target.filters[filter.field]?.field ?? filter.field)];
  if (definition.sql || referenced.some(field => field && target.dimensions[field]?.sql)) {
    throw new Error(`SQL-backed measure "${name}" or its inputs cannot be traversed through relationships.`);
  }
  return { relationshipName: parsed.relationship, relationship, target, definition };
}

export function listRelationshipMeasures(name: string, relationship: RelationshipDefinition): Record<string, MeasureDefinition> {
  if (relationship.kind === 'hasMany') return {};
  const ds = { relationships: { [name]: relationship } } as AnyDatasetInstance;
  const target = relationship.target() as AnyDatasetInstance;
  return Object.fromEntries(Object.keys(target.measures).flatMap(measure => {
    const qualified = `${name}.${measure}`;
    try { return [[qualified, resolveRelationshipMeasure(ds, qualified).definition]]; }
    catch { return []; }
  }));
}

/** Expand selected relationship aggregates for dependency graphs without changing author definitions. */
export function queryMeasureDefinitions(ds: AnyDatasetInstance, selected: readonly string[]) {
  const qualified = selected.filter(name => name.includes('.'));
  return qualified.length ? {
    ...ds.measures,
    ...Object.fromEntries(qualified.map(name => [name, resolveRelationshipMeasure(ds, name).definition])),
  } : ds.measures;
}

/** Resolve a selected measure or a dimension reference while collecting joins. */
export function resolveRelationshipReference(ds: AnyDatasetInstance, name: string, measures: readonly string[] = []) {
  if (!measures.includes(name)) return resolveQualifiedField(ds, name);
  try { return { resolved: resolveRelationshipMeasure(ds, name) }; }
  catch (error) { return { error: (error as Error).message }; }
}
