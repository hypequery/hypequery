import type { DatasetQuery } from '../types.js';
import type { DatasetQueryCalculation } from './query-calculation-types.js';
import { protocolComparisonNode, protocolFilterNode } from './protocol-filter-nodes.js';

/**
 * A dataset client query as an RFC 0003 dataset query envelope, the operation
 * a semantic data plane validates (`validateProtocolSemanticQuery`) and runs.
 *
 * The inverse of what the portable runtime does with an operation it is
 * handed: comparisons and `and`/`or`/`not` groups become `comparison` and
 * `logical` predicates (RFC 0029), a filter calculation's `where` becomes
 * comparisons (RFC 0026), and every other field is copied in document order.
 * Nothing is dropped, so a field the receiving validator does not accept fails
 * there rather than being silently ignored. A grain is the envelope's `by`.
 *
 * `inDateRange` is carried as written: the executor resolves it with its own
 * clock and the query's timezone, never the caller's.
 */
export function toProtocolDatasetQuery(
  dataset: string,
  query: DatasetQuery & { readonly includeMeta?: boolean },
): Record<string, unknown> {
  const copy = <T>(value: T | undefined) => (value === undefined ? undefined : structuredClone(value));
  const entries: Array<[string, unknown]> = [
    ['dimensions', copy(query.dimensions)],
    ['measures', copy(query.measures)],
    ['filters', query.filters?.map(protocolFilterNode)],
    ['segments', copy(query.segments)],
    ['calculations', query.calculations?.map(protocolCalculation)],
    ['having', copy(query.having)],
    ['limitBy', copy(query.limitBy)],
    ['other', copy(query.other)],
    ['orderBy', query.orderBy?.map(({ field, direction }) => ({ field, direction }))],
    ['limit', query.limit],
    ['offset', query.offset],
    ['by', query.by],
    ['timeKey', query.timeKey],
    ['timezone', query.timezone],
    ['fill', query.fill],
    ['includeMeta', query.includeMeta],
  ];
  return {
    kind: 'dataset',
    dataset,
    ...Object.fromEntries(entries.filter(([, value]) => value !== undefined)),
  };
}

/** A calculation entry; only a filter calculation's `where` changes shape. */
function protocolCalculation(entry: DatasetQueryCalculation): Record<string, unknown> {
  if (!('filter' in entry) || entry.filter === undefined) return structuredClone(entry) as Record<string, unknown>;
  return {
    name: entry.name,
    filter: { measure: entry.filter.measure, where: entry.filter.where.map(protocolComparisonNode) },
  };
}
