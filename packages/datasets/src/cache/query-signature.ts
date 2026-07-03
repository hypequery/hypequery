/**
 * Canonical cache keys for semantic queries.
 *
 * A signature captures everything that changes a query's result set: the
 * target (dataset or metric), selected dimensions/measures, filters, ordering,
 * pagination, time grain, and the effective tenant scope. Two calls with the
 * same signature are guaranteed to produce the same rows against the same
 * underlying data, so the signature is safe to use as a result-cache key.
 *
 * Keys are readable canonical JSON rather than hashes so stores can inspect
 * them and tests can assert on them; stores are free to hash internally.
 */

import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  GrainedMetricRef,
  MetricFilter,
  MetricOrderBy,
  MetricQuery,
  MetricRef,
} from '../types.js';
import { getMetricGrain, getMetricRef, type MetricHandle } from '../utils/metric-handle.js';
import { getRuntimeTenantPredicate } from '../utils/tenant-runtime.js';

const SIGNATURE_VERSION = 1;

/** JSON.stringify with recursively sorted object keys, so key order never matters. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function filterSignature(filters: MetricFilter[] | undefined) {
  return (filters ?? []).map((filter) => ({
    field: filter.field,
    operator: filter.operator,
    value: filter.value ?? null,
  }));
}

function orderBySignature(orderBy: MetricOrderBy[] | undefined) {
  return (orderBy ?? []).map((order) => ({
    field: order.field,
    direction: order.direction,
  }));
}

/**
 * Tenant portion of the key. Only datasets with a `tenantKey` apply the
 * runtime tenant predicate, so tenant-less datasets share entries across
 * callers while tenant-scoped datasets are strictly partitioned per scope.
 */
function tenantSignature(ds: AnyDatasetInstance, context?: ExecutionContext) {
  if (!ds.tenantKey) {
    return null;
  }
  const predicate = getRuntimeTenantPredicate(context);
  if (!predicate) {
    // Trusted cross-tenant scope (`scope: 'all'`) or no runtime tenancy.
    return { key: ds.tenantKey, scope: 'all' };
  }
  return { key: ds.tenantKey, operator: predicate.operator, value: predicate.value };
}

export function buildDatasetQuerySignature(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): string {
  return stableStringify({
    v: SIGNATURE_VERSION,
    kind: 'dataset',
    target: ds.name,
    source: ds.source,
    dimensions: query.dimensions ?? null,
    // `null` distinguishes the "all measures" default from an explicit [].
    measures: query.measures ?? null,
    filters: filterSignature(query.filters),
    orderBy: orderBySignature(query.orderBy),
    by: query.by ?? null,
    limit: query.limit ?? null,
    offset: query.offset ?? null,
    tenant: tenantSignature(ds, context),
  });
}

export function buildMetricQuerySignature(
  metric: MetricRef | GrainedMetricRef,
  query: MetricQuery,
  context?: ExecutionContext,
): string {
  const ref = getMetricRef(metric as MetricHandle);
  const grain = getMetricGrain(metric as MetricHandle, query);
  return stableStringify({
    v: SIGNATURE_VERSION,
    kind: 'metric',
    target: `${ref.dataset.name}.${ref.name}`,
    source: ref.dataset.source,
    metricKind: ref.spec.__type,
    dimensions: query.dimensions ?? null,
    filters: filterSignature(query.filters),
    orderBy: orderBySignature(query.orderBy),
    by: grain ?? null,
    limit: query.limit ?? null,
    offset: query.offset ?? null,
    tenant: tenantSignature(ref.dataset, context),
  });
}
