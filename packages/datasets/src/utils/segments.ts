/**
 * Dataset segments (RFC 0015): named, author-defined row filters that a query
 * selects by name.
 *
 * A segment compares the dataset's own dimensions with literals. It may use a
 * dimension that is not exposed as a filter: the filter allow-list governs
 * what a caller may construct, not what an author may declare. It may not
 * traverse a relationship or constrain the tenant column, which only trusted
 * runtime context scopes.
 */

import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import type { AnyDatasetInstance, DimensionDefinition, MetricFilter, SegmentDefinition } from '../types.js';
import { validateFilterValue } from '../validation.js';

const SEGMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPERATORS: ReadonlySet<string> = new Set(SEMANTIC_FILTER_OPERATORS);

interface SegmentOwner {
  readonly tenantKey?: string;
  readonly dimensions: Readonly<Record<string, DimensionDefinition>>;
}

/** Throws when a declared segment is malformed; returns a frozen copy otherwise. */
export function normalizeSegments(
  datasetName: string,
  owner: SegmentOwner,
  segments: Record<string, SegmentDefinition> | undefined,
): Record<string, SegmentDefinition> {
  const fail = (name: string, message: string): never => {
    throw new Error(`Invalid segment "${name}" on dataset "${datasetName}": ${message}`);
  };
  const result: Record<string, SegmentDefinition> = {};
  for (const [name, segment] of Object.entries(segments ?? {})) {
    if (!SEGMENT_NAME.test(name)) fail(name, 'names must be identifiers (letters, digits, underscores).');
    if (!Array.isArray(segment?.filters) || segment.filters.length === 0) {
      fail(name, 'filters must be a non-empty array.');
    }
    for (const filter of segment.filters) {
      const dimension = Object.hasOwn(owner.dimensions, filter.field) ? owner.dimensions[filter.field] : undefined;
      if (!dimension) {
        fail(name, `"${filter.field}" is not a dimension of this dataset; segments cannot use relationships.`);
      }
      const column = dimension!.column ?? filter.field;
      if (owner.tenantKey !== undefined && (column === owner.tenantKey || filter.field === owner.tenantKey)) {
        fail(name, `"${filter.field}" is the tenant column, which only runtime tenant scoping may constrain.`);
      }
      if (!OPERATORS.has(filter.operator)) fail(name, `unsupported operator "${String(filter.operator)}".`);
      const valueError = validateFilterValue(filter, dimension!.fieldType);
      if (valueError) fail(name, valueError);
    }
    result[name] = Object.freeze({
      filters: Object.freeze(segment.filters.map(filter => Object.freeze({ ...filter }))) as MetricFilter[],
      ...(segment.label !== undefined ? { label: segment.label } : {}),
      ...(segment.description !== undefined ? { description: segment.description } : {}),
    });
  }
  return Object.freeze(result);
}

/**
 * Publishing emits deployment contract 2, which cannot carry segments
 * (RFC 0015), so a dataset that declares them is refused by name.
 */
export function assertNoPublishedSegments(ds: Pick<AnyDatasetInstance, 'name' | 'segments'>): void {
  const names = Object.keys(ds.segments ?? {});
  if (names.length > 0) {
    throw new Error(
      `Dataset "${ds.name}" declares segments (${names.join(', ')}), which cannot be published yet: ` +
      'segments need deployment contract 3 (RFC 0015). Use them for local queries until publishing emits contract 3.',
    );
  }
}

/** Validation errors for a query's `segments` selection. */
export function segmentSelectionErrors(ds: AnyDatasetInstance, names: unknown): string[] {
  if (names === undefined) return [];
  if (!Array.isArray(names)) return ['segments must be an array of segment names.'];
  const errors: string[] = [];
  const seen = new Set<string>();
  const available = Object.keys(ds.segments ?? {});
  for (const name of names) {
    if (typeof name !== 'string' || !Object.hasOwn(ds.segments ?? {}, name)) {
      errors.push(
        `Unknown segment "${String(name)}" on dataset "${ds.name}". Available: ${available.join(', ') || '(none)'}`,
      );
    } else if (seen.has(name)) {
      errors.push(`Segment "${name}" is selected more than once.`);
    }
    seen.add(String(name));
  }
  return errors;
}

/**
 * The conditions a selection applies, as filters over dimension names. Order
 * follows the selection, then each segment's authored filters.
 */
export function segmentFilters(ds: AnyDatasetInstance, names: readonly string[] | undefined): MetricFilter[] {
  return (names ?? []).flatMap(name => ds.segments?.[name]?.filters ?? []);
}
