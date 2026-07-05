import type {
  QueryBuilderFactoryLike,
  SemanticCacheRuntime,
  SemanticExecutionRuntime,
} from "@hypequery/datasets";
import { toQueryBuilderFactory } from "@hypequery/datasets";

export const INTERNAL_SEMANTIC_RUNTIME_KEY = "__hypequerySemanticRuntime";

/**
 * Per-request semantic runtime carried on the serve context. Extends the
 * datasets execution runtime with serve-only fields that endpoints translate
 * into the `ExecutionContext` they build (`cacheScope` → `cache.scope`).
 */
export interface ServeSemanticRuntime extends SemanticExecutionRuntime {
  /**
   * Cache partition for semantic queries in this request, mixed into the
   * result-cache key. Required for entry-level caching to stay enabled when
   * the request also overrides `builderFactory` (per-request warehouse
   * routing): the cache key alone cannot tell two data sources apart, so an
   * unscoped override bypasses the cache. Use a stable identifier for the
   * data source the override points at (e.g. `'replica-eu'`).
   */
  cacheScope?: string;
}

function isSemanticExecutionRuntime(value: unknown): value is ServeSemanticRuntime {
  return typeof value === 'object' && value !== null;
}

/**
 * Type guard to check if a value is a QueryBuilderFactoryLike.
 * Uses duck-typing to detect the required methods.
 */
export function isQueryBuilderFactoryLike(value: unknown): value is QueryBuilderFactoryLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'table' in value &&
    typeof value.table === 'function' &&
    'rawQuery' in value &&
    typeof value.rawQuery === 'function'
  );
}

/**
 * Extract queryBuilder from context.db if available.
 * This allows users to pass queryBuilder via context instead of top-level config.
 */
export function extractQueryBuilderFromContext(
  context: Record<string, unknown>
): QueryBuilderFactoryLike | undefined {
  // Check if context.db is a queryBuilder
  if ('db' in context && isQueryBuilderFactoryLike(context.db)) {
    return context.db as QueryBuilderFactoryLike;
  }

  // Check if it's already in the semantic runtime
  const runtime = resolveSemanticExecutionRuntime(context);
  if (runtime?.builderFactory) {
    return toQueryBuilderFactory(runtime.builderFactory);
  }

  return undefined;
}

export function attachSemanticQueryBuilder<
  TContext extends Record<string, unknown>,
>(
  context: TContext,
  builderFactory: QueryBuilderFactoryLike | undefined,
): TContext {
  if (!builderFactory) {
    return context;
  }

  return attachSemanticRuntime(context, { builderFactory });
}

export function attachSemanticRuntime<TContext extends Record<string, unknown>>(
  context: TContext,
  runtime: ServeSemanticRuntime,
): TContext {
  const current = resolveSemanticExecutionRuntime(context);
  return {
    ...context,
    [INTERNAL_SEMANTIC_RUNTIME_KEY]: {
      ...(current ?? {}),
      ...runtime,
      tenant: runtime.tenant ?? current?.tenant,
      cacheScope: runtime.cacheScope ?? current?.cacheScope,
    } satisfies ServeSemanticRuntime,
  };
}

/**
 * Attach a result-cache partition for the semantic queries in this request
 * without touching the rest of the runtime. Shorthand for
 * `attachSemanticRuntime(context, { cacheScope })`.
 */
export function attachSemanticCacheScope<TContext extends Record<string, unknown>>(
  context: TContext,
  cacheScope: string,
): TContext {
  return attachSemanticRuntime(context, { cacheScope });
}

export function resolveSemanticExecutionRuntime(
  context: Record<string, unknown>,
): ServeSemanticRuntime | undefined {
  const candidate = context[INTERNAL_SEMANTIC_RUNTIME_KEY];
  if (!isSemanticExecutionRuntime(candidate)) {
    return undefined;
  }
  return candidate;
}

export function resolveSemanticCacheScope(
  context: Record<string, unknown>,
): string | undefined {
  return resolveSemanticExecutionRuntime(context)?.cacheScope;
}

export function resolveSemanticQueryBuilder(
  context: Record<string, unknown>,
  fallback: QueryBuilderFactoryLike,
): QueryBuilderFactoryLike {
  const override = resolveSemanticExecutionRuntime(context)?.builderFactory;
  return override ? toQueryBuilderFactory(override) : fallback;
}

/**
 * The genuine per-request builder override, if any. Returns `undefined` when
 * no builder was attached or when the attached builder is the endpoint's own
 * default (create-api attaches the configured builder to every request for
 * context consumers) — the client executes with its own factory in that case,
 * and forwarding it as an override would needlessly disable result caching.
 */
export function resolveSemanticQueryBuilderOverride(
  context: Record<string, unknown>,
  defaultBuilderFactory: QueryBuilderFactoryLike,
): QueryBuilderFactoryLike | undefined {
  const override = resolveSemanticExecutionRuntime(context)?.builderFactory;
  if (!override) {
    return undefined;
  }
  const adapted = toQueryBuilderFactory(override);
  return adapted === defaultBuilderFactory ? undefined : adapted;
}

/**
 * Per-call cache controls for a semantic endpoint execution: the entry-level
 * TTL plus any middleware-attached cache scope. Returns `undefined` when
 * neither applies so uncached endpoints skip cache handling entirely.
 */
export function buildEndpointCacheRuntime(
  entryTtlMs: number | null | undefined,
  cacheScope: string | undefined,
): SemanticCacheRuntime | undefined {
  const ttlMs = typeof entryTtlMs === 'number' && entryTtlMs > 0 ? entryTtlMs : undefined;
  if (ttlMs === undefined && cacheScope === undefined) {
    return undefined;
  }
  return { ttlMs, scope: cacheScope };
}

export function attachSemanticTenantRuntime<TContext extends Record<string, unknown>>(
  context: TContext,
  options: {
    tenantId: string;
  },
): TContext {
  return attachSemanticRuntime(context, {
    tenant: {
      id: options.tenantId,
    },
  });
}
