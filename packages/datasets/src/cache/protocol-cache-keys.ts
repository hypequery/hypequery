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
import { localDefinitionIdentity, scopedDefinitionIdentity } from './definition-identity.js';

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
    left: { kind: 'reference', name: filter.field },
    right: { kind: 'literal', value: literal },
  };
}

function sharedQueryFields(query: DatasetQuery | MetricQuery): Record<string, unknown> {
  return {
    ...(query.dimensions !== undefined ? { dimensions: [...query.dimensions] } : {}),
    ...(query.filters !== undefined ? { filters: query.filters.map(filterNode) } : {}),
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

function definitionFor(
  settings: ProtocolCacheKeySettings,
  root: AnyDatasetInstance,
  scope: string | undefined,
  query: DatasetQuery | MetricQuery,
  metric?: unknown,
): string {
  const timezone = partitionTimezone(query);
  return settings.definitionIdentity !== undefined
    ? scopedDefinitionIdentity(settings.definitionIdentity, scope, timezone)
    : localDefinitionIdentity(root, { metric, scope, timezone });
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
  try {
    const wire = {
      kind: 'dataset',
      dataset: ds.name,
      ...sharedQueryFields(query),
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
      ...sharedQueryFields(query),
      ...(grain !== undefined ? { by: grain } : {}),
    };
    const definition = definitionFor(settings, ref.dataset, scope, query, ref.spec);
    return deriveKey(settings, wire, definition, context, query.limit);
  } catch {
    return undefined;
  }
}
