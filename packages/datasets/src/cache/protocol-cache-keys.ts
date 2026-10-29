import {
  buildProtocolCachePreimage,
  deriveProtocolCacheKey,
  validateCanonicalValue,
  type CanonicalValue,
  type ProtocolCacheTenantScope,
} from '@hypequery/protocol';
import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  GrainedMetricRef,
  MetricFilter,
  MetricQuery,
  MetricRef,
} from '../types.js';
import { getMetricGrain, getMetricRef, type MetricHandle } from '../utils/metric-handle.js';
import { runtimeConstraints } from '../utils/row-scope.js';
import { localDefinitionIdentity, scopedDefinitionIdentity } from './definition-identity.js';
import { selectsAlternateTimeKey } from '../utils/dataset-time-keys.js';

/** Namespace defaults, so caching works without any configuration. */
export const DEFAULT_CACHE_PROJECT = 'hypequery';
export const DEFAULT_CACHE_ENVIRONMENT = 'default';
const SECRET_BYTES = 32;
const DEFINITION_IDENTITY = /^[0-9a-f]{64}$/;

/** Key settings from `SemanticCacheOptions`, resolved once per client. */
export interface ProtocolCacheKeySettings {
  readonly secret: Uint8Array;
  readonly project: string;
  readonly environment: string;
  readonly keyVersion: number;
  readonly definitionIdentity?: string;
}

export interface ProtocolCacheKeyOptions {
  secret?: Uint8Array;
  project?: string;
  environment?: string;
  keyVersion?: number;
  definitionIdentity?: string;
}

let warnedSharedStoreWithoutSecret = false;

/**
 * Resolves and validates key settings at client construction, so a
 * misconfiguration fails at startup rather than silently caching nothing.
 *
 * Without a secret the cache generates a random one for its lifetime. Keys
 * stay HMAC-derived and opaque; entries are simply not shared beyond this
 * client. An explicitly empty or short secret is an error, never a reason to
 * generate one.
 */
export function resolveProtocolCacheKeySettings(
  options: ProtocolCacheKeyOptions,
  sharedStore: boolean,
): ProtocolCacheKeySettings {
  let secret = options.secret;
  if (secret === undefined) {
    secret = globalThis.crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    if (sharedStore && !warnedSharedStoreWithoutSecret) {
      warnedSharedStoreWithoutSecret = true;
      console.warn(
        '[hypequery/cache] No cache secret is configured, so this client generated one. '
          + 'Other instances sharing this store will not reuse its entries. '
          + 'Pass the same cache.secret to every instance to share them.',
      );
    }
  }
  if (
    options.definitionIdentity !== undefined
    && !DEFINITION_IDENTITY.test(options.definitionIdentity)
  ) {
    throw new Error('cache.definitionIdentity must be 64 lowercase hexadecimal characters.');
  }
  const settings: ProtocolCacheKeySettings = {
    secret,
    project: options.project ?? DEFAULT_CACHE_PROJECT,
    environment: options.environment ?? DEFAULT_CACHE_ENVIRONMENT,
    keyVersion: options.keyVersion ?? 1,
    ...(options.definitionIdentity !== undefined
      ? { definitionIdentity: options.definitionIdentity }
      : {}),
  };
  // Throws ProtocolCacheKeyError for an empty or short secret, an invalid
  // namespace, or an out-of-range key version.
  deriveProtocolCacheKey({
    secret: settings.secret,
    namespace: { project: settings.project, environment: settings.environment },
    keyVersion: settings.keyVersion,
    preimage: '',
  });
  return settings;
}

function datetimeValue(value: Date): CanonicalValue {
  return validateCanonicalValue({
    $hypequery: {
      type: 'datetime',
      version: 1,
      clickhouseType: 'DateTime64',
      precision: 3,
      timezone: 'UTC',
      value: value.toISOString(),
    },
  });
}

/** A filter value as an RFC 0001 canonical value. Throws when it has none. */
function canonicalLiteral(value: unknown): CanonicalValue {
  if (value instanceof Date) return datetimeValue(value);
  if (Array.isArray(value)) {
    return validateCanonicalValue({
      $hypequery: { type: 'array', version: 1, values: value.map(canonicalLiteral) },
    });
  }
  return validateCanonicalValue(value);
}

function filterNode(filter: MetricFilter): Record<string, unknown> {
  const left = { kind: 'reference', name: filter.field };
  // A null check has no value, so its node has no right operand (RFC 0023).
  if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
    return { kind: 'comparison', operator: filter.operator, left };
  }
  let literal: CanonicalValue;
  if (filter.operator === 'between' && Array.isArray(filter.value)) {
    // RFC 0003 bounds are a two-item tuple; in/notIn take an array.
    literal = validateCanonicalValue({
      $hypequery: { type: 'tuple', version: 1, values: filter.value.map(canonicalLiteral) },
    });
  } else {
    literal = canonicalLiteral(filter.value);
  }
  return {
    kind: 'comparison',
    operator: filter.operator,
    left,
    right: { kind: 'literal', value: literal },
  };
}

/**
 * The call's filters as the preimage sees them: the caller's, then the
 * enforced constraints (RFC 0020). Constraints change rows, so they must
 * change the key; the preimage sorts and dedupes filters, so a constraint and
 * an identical caller filter (which yield the same rows) share an entry.
 */
function effectiveFilters(query: DatasetQuery | MetricQuery, context: ExecutionContext | undefined) {
  const constraints = runtimeConstraints(context);
  if (constraints.length === 0) return query.filters;
  return [...(query.filters ?? []), ...constraints];
}

function sharedQueryFields(query: DatasetQuery | MetricQuery, context: ExecutionContext | undefined): Record<string, unknown> {
  const filters = effectiveFilters(query, context);
  return {
    ...(query.dimensions !== undefined ? { dimensions: [...query.dimensions] } : {}),
    ...(filters !== undefined ? { filters: filters.map(filterNode) } : {}),
    ...(query.segments !== undefined ? { segments: [...query.segments] } : {}),
    ...(query.orderBy !== undefined
      ? { orderBy: query.orderBy.map(({ field, direction }) => ({ field, direction })) }
      : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.offset !== undefined ? { offset: query.offset } : {}),
  };
}

/** The tenant capability present on the call, whether or not it is applied. */
function tenantScope(context: ExecutionContext | undefined): ProtocolCacheTenantScope {
  const tenant = context?.runtime?.tenant;
  if (tenant === undefined) return { mode: 'none' };
  if (typeof tenant === 'string') return { mode: 'scoped', ids: [tenant] };
  if ('scope' in tenant && tenant.scope === 'all') return { mode: 'all' };
  if ('id' in tenant) return { mode: 'scoped', ids: [tenant.id] };
  if ('in' in tenant) return { mode: 'scoped', ids: [...tenant.in] };
  // Unrecognized runtime shapes fail preimage validation and run uncached.
  return tenant as unknown as ProtocolCacheTenantScope;
}

function deriveKey(
  settings: ProtocolCacheKeySettings,
  query: Record<string, unknown>,
  definitionIdentity: string,
  context: ExecutionContext | undefined,
  rowLimit: number | undefined,
): string {
  const preimage = buildProtocolCachePreimage({
    secret: settings.secret,
    definitionIdentity,
    query,
    tenant: tenantScope(context),
    rowLimit: rowLimit ?? null,
  });
  return deriveProtocolCacheKey({
    secret: settings.secret,
    namespace: { project: settings.project, environment: settings.environment },
    keyVersion: settings.keyVersion,
    preimage,
  });
}

/**
 * RFC 0009's normalized query has no timezone, yet it moves bucket boundaries
 * and local time-key bounds. It is folded into the definition identity, as
 * `scope` is. UTC, the client default, folds in nothing, so default queries
 * keep the keys other runtimes derive for the same release.
 */
function partitionTimezone(query: DatasetQuery | MetricQuery): string | undefined {
  return query.timezone === 'UTC' ? undefined : query.timezone;
}

/**
 * RFC 0009's normalized query has no time axis either. An alternate axis is
 * folded in like the timezone; the default, named or omitted, folds in nothing.
 */
function partitionTimeKey(root: AnyDatasetInstance, query: DatasetQuery | MetricQuery): string | undefined {
  return selectsAlternateTimeKey(root, query.timeKey) ? query.timeKey : undefined;
}

function definitionFor(
  settings: ProtocolCacheKeySettings,
  root: AnyDatasetInstance,
  scope: string | undefined,
  query: DatasetQuery | MetricQuery,
  metric?: unknown,
): string {
  const timezone = partitionTimezone(query);
  const timeKey = partitionTimeKey(root, query);
  return settings.definitionIdentity !== undefined
    ? scopedDefinitionIdentity(settings.definitionIdentity, scope, timezone, timeKey)
    : localDefinitionIdentity(root, { metric, scope, timezone, timeKey });
}

/**
 * The RFC 0013 store key for a dataset query, or `undefined` when the call
 * cannot be cached (for example, a filter value with no portable form).
 * `query` must already carry its effective limit.
 */
export function datasetCacheKey(
  settings: ProtocolCacheKeySettings,
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context: ExecutionContext | undefined,
  scope: string | undefined,
): string | undefined {
  // RFC 0009's normalized query has no `having`, so no portable key can
  // separate queries that differ only in their conditions. Run them uncached,
  // as the Python SDK does, until the shared preimage covers `having`.
  if (query.having !== undefined && query.having.length > 0) return undefined;
  try {
    const wire = {
      kind: 'dataset',
      dataset: ds.name,
      ...sharedQueryFields(query, context),
      ...(query.measures !== undefined ? { measures: [...query.measures] } : {}),
      ...(query.by !== undefined ? { by: query.by } : {}),
    };
    return deriveKey(settings, wire, definitionFor(settings, ds, scope, query), context, query.limit);
  } catch {
    // A cache failure never fails a query: run uncached.
    return undefined;
  }
}

/** The RFC 0013 store key for a metric query; see `datasetCacheKey`. */
export function metricCacheKey(
  settings: ProtocolCacheKeySettings,
  metric: MetricRef | GrainedMetricRef,
  query: MetricQuery,
  context: ExecutionContext | undefined,
  scope: string | undefined,
): string | undefined {
  try {
    const ref = getMetricRef(metric as MetricHandle);
    const grain = getMetricGrain(metric as MetricHandle, query);
    const wire = {
      kind: 'metric',
      dataset: ref.dataset.name,
      metric: ref.name,
      ...sharedQueryFields(query, context),
      ...(grain !== undefined ? { by: grain } : {}),
    };
    const definition = definitionFor(settings, ref.dataset, scope, query, ref.spec);
    return deriveKey(settings, wire, definition, context, query.limit);
  } catch {
    return undefined;
  }
}
