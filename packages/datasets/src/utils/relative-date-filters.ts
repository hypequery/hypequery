import { isProtocolRelativeDateRange } from '@hypequery/protocol';
import type { AnyDatasetInstance, DatasetFilterNode, MetricFilter } from '../types.js';
import { filterTreeErrors, isFilterGroup } from './filter-tree.js';
import { datasetTimeKeys } from './dataset-time-keys.js';
import { isTimeKeyFilter } from './query-timezone.js';
import { resolveRelativeDateRange } from './relative-date-range.js';

/**
 * `inDateRange` caller filters (RFC 0029). The client resolves each one to a
 * half-open `gte`/`lt` pair once per query, before validation, caching and
 * planning, so every later stage sees ordinary comparisons on the time axis.
 */

const GRAMMAR = 'today, yesterday, this|last <unit>, last <N> <unit>s or month|quarter|year to date (unit: day, week, month, quarter, year)';

/** Why `filter` can't be resolved, or `undefined` when it can. */
export function relativeDateFilterError(ds: AnyDatasetInstance, filter: MetricFilter): string | undefined {
  const axes = datasetTimeKeys(ds);
  // Compared by backing column, as the planner reads the axis: a `timeKey`
  // may name a column that a differently named dimension reads.
  if (!isTimeKeyFilter(ds, filter.field)) {
    return axes.length === 0
      ? `Filter "${filter.field}" cannot use "inDateRange": dataset "${ds.name}" has no time axis.`
      : `Filter "${filter.field}" cannot use "inDateRange": it applies only to a time axis (${axes.join(', ')}).`;
  }
  if (!isProtocolRelativeDateRange(filter.value)) {
    return `Filter "${filter.field}": ${JSON.stringify(filter.value) ?? String(filter.value)} is not a relative date range. Use ${GRAMMAR}.`;
  }
  return undefined;
}

/**
 * The query's filters with every resolvable `inDateRange` replaced by its
 * bounds. A comparison at the top level, or directly inside an `and`, becomes
 * two comparisons there, so a top-level range still bounds the time axis; one
 * under `or`/`not` becomes an `and` group. Unresolvable ones, and every
 * filter of a malformed tree, are left for validation to report.
 */
export function resolveRelativeDateFilters(
  ds: AnyDatasetInstance,
  filters: DatasetFilterNode[] | undefined,
  now: Date,
  timezone: string | undefined,
): DatasetFilterNode[] | undefined {
  // A malformed tree (a null filter, a cycle, a group nested too deep) is left
  // as written: validation reports it, and walking it here could throw.
  if (!Array.isArray(filters) || filterTreeErrors(filters).length > 0) return filters;
  let changed = false;
  const bounds = (filter: MetricFilter): MetricFilter[] | undefined => {
    if (filter.operator !== 'inDateRange' || typeof filter.field !== 'string' || relativeDateFilterError(ds, filter)) {
      return undefined;
    }
    const range = resolveRelativeDateRange(filter.value, now, timezone ?? 'UTC')!;
    changed = true;
    return [
      { field: filter.field, operator: 'gte', value: range.start },
      { field: filter.field, operator: 'lt', value: range.end },
    ];
  };
  // Within a conjunction (the top level, an `and`), bounds splice in place.
  const conjunction = (nodes: readonly DatasetFilterNode[]): DatasetFilterNode[] => nodes.flatMap(node => {
    if (!isFilterGroup(node)) return bounds(node) ?? [node];
    return [group(node)];
  });
  const single = (node: DatasetFilterNode): DatasetFilterNode => {
    if (!isFilterGroup(node)) {
      const resolved = bounds(node);
      return resolved ? { and: resolved } : node;
    }
    return group(node);
  };
  // The tree is well formed here: each group has exactly one key.
  const group = (node: DatasetFilterNode): DatasetFilterNode => {
    const record = node as { and?: DatasetFilterNode[]; or?: DatasetFilterNode[]; not?: DatasetFilterNode };
    if (record.and) return { and: conjunction(record.and) };
    if (record.or) return { or: record.or.map(single) };
    return { not: single(record.not!) };
  };
  const resolved = conjunction(filters);
  return changed ? resolved : filters;
}
