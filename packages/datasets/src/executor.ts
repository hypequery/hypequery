/** Dataset client orchestration: runtime defaults, caching, limits and target dispatch. */
import type {
  MetricRef, GrainedMetricRef, MetricQuery, MetricQueryFor, MetricResult, MetricResultFor,
  DatasetQuery, DatasetQueryFor, DatasetQueryResult, DatasetQueryResultFor,
  ExecutionContext, AnyDatasetInstance, DatasetInstance,
} from './types.js';
import type { QueryBuilderFactoryInput } from './query-builder-protocol.js';
import { toQueryBuilderFactory } from './query-builder-protocol.js';
import type { PlanNode, SemanticBackend } from './semantic-plan.js';
import type { ValidationResult } from './validation.js';
import { MetricQueryEngine } from './metric-query-engine.js';
import { runDatasetQuery, validateDatasetQuery, type DatasetQueryExecutionOptions } from './dataset-query.js';
import { buildDatasetPlan, buildMetricPlan } from './semantic-planner.js';
import { assertMetricHandle, getMetricRef } from './utils/metric-handle.js';
import { validateMetricQueryInput } from './utils/metric-query-validation.js';
import { prepareDatasetQuery } from './utils/compile-dataset-query.js';
import { snapshotExecutionContext } from './utils/snapshot-execution-context.js';
import type { DatasetCompilation } from './dataset-compilation.js';
import { isDatasetInstance } from './utils/dataset-target.js';
import { queryTimezoneErrors } from './utils/query-timezone.js';
import { rejectTimeMeasuresOnBackend } from './utils/time-query-measures.js';
import { baseMeasureNames } from './utils/dataset-measures.js';
import { hasSelectedDerivedMeasure } from './utils/dataset-derived-query.js';
import { serializeSemanticMeasureValues } from './utils/semantic-result-serialization.js';
import { resolveResultLimit, withResultLimit } from './utils/result-limits.js';
import { resolveDatasetCacheRuntime, type ClientCacheDefaults } from './utils/dataset-cache-policy.js';
import {
  SemanticQueryCache,
  type SemanticCacheOptions,
  type SemanticCacheStats,
} from './cache/semantic-query-cache.js';
import {
  datasetCacheKey,
  metricCacheKey,
  resolveProtocolCacheKeySettings,
  type ProtocolCacheKeySettings,
} from './cache/protocol-cache-keys.js';

// Preserve the existing module surface for internal consumers.
export { MetricQueryEngine } from './metric-query-engine.js';
export type { MetricQueryEngineOptions } from './metric-query-engine.js';

export interface CreateDatasetClientOptions {
  /** Default IANA timezone for buckets and local time-key bounds. Queries can override it. */
  timezone?: string;
  /** Query builder factory for executing semantic metric and dataset queries. */
  queryBuilder?: QueryBuilderFactoryInput;
  /**
   * Semantic backend for executing neutral semantic plans.
   *
   * @deprecated Use `queryBuilder` instead — the query-builder path is
   * canonical. The plan/backend path is frozen (bug fixes only) and will not
   * gain new features.
   */
  backend?: SemanticBackend;
  /**
   * Result-cache defaults for this client. Results are keyed by the canonical
   * query signature (target, dimensions, measures, filters, ordering,
   * pagination, grain, and tenant scope). Individual calls can override or
   * bypass via `ExecutionContext.cache`; per-call `{ cache: { ttlMs } }` works
   * even when this option is omitted.
   */
  cache?: SemanticCacheOptions;
}

export type SemanticTarget = MetricRef | GrainedMetricRef | AnyDatasetInstance;

export type SemanticQuery<TTarget extends SemanticTarget> =
  TTarget extends AnyDatasetInstance ? DatasetQuery : MetricQuery;

export type SemanticResult<
  TTarget extends SemanticTarget,
  TRow = Record<string, unknown>,
> = TTarget extends AnyDatasetInstance
  ? DatasetQueryResult<TRow>
  : MetricResult<TRow>;

type TypedDataset<TDatasetName extends string = string> =
  DatasetInstance<any, any, any, TDatasetName>;

type TypedMetricRef<
  TDatasetName extends string,
  TMetricName extends string,
  TDataset extends TypedDataset<TDatasetName>,
> = MetricRef<TDatasetName, TMetricName, any, TDataset>;

type TypedGrainedMetricRef<
  TDatasetName extends string,
  TMetricName extends string,
  TDataset extends TypedDataset<TDatasetName>,
> = GrainedMetricRef<TDatasetName, TMetricName, any, TDataset>;

export interface DatasetClient {
  execute<
    TDataset extends TypedDataset,
    const TQuery extends DatasetQueryFor<TDataset> = DatasetQueryFor<TDataset>,
  >(
    target: TDataset,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<DatasetQueryResultFor<TDataset, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends TypedDataset<TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: TypedMetricRef<TDatasetName, TMetricName, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends TypedDataset<TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: TypedGrainedMetricRef<TDatasetName, TMetricName, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends TypedDataset<TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: TypedMetricRef<TDatasetName, TMetricName, TDataset> | TypedGrainedMetricRef<TDatasetName, TMetricName, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  /** Explicit row types opt into the legacy dynamic query contract. */
  execute<TRow = never, TTarget extends SemanticTarget = SemanticTarget>(
    target: [TRow] extends [never] ? never : TTarget,
    query?: SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): Promise<SemanticResult<TTarget, TRow>>;
  /** Compile the actual dataset execution SQL, including ceilings and pagination overfetch.
   * SQL and parameters are trusted-only; describe()/JSON serialization omit values.
   * Frozen semantic backends and standalone metric handles are not supported.
   */
  compileDataset<TDataset extends TypedDataset>(
    target: TDataset,
    query?: DatasetQueryFor<TDataset>,
    context?: ExecutionContext,
  ): DatasetCompilation;
  toSQL<TTarget extends SemanticTarget>(
    target: TTarget,
    query?: SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): string;
  validate<TTarget extends SemanticTarget>(
    target: TTarget,
    query?: SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): ValidationResult;
  /** Lookup counters for this client's semantic result cache. */
  getCacheStats(): SemanticCacheStats;
  /**
   * Clears the semantic result cache. Returns false when the configured store
   * does not support clearing (see `SemanticCacheStats.clearSupported`).
   */
  clearCache(): Promise<boolean>;
}

export class DatasetClientImpl extends MetricQueryEngine implements DatasetClient {
  private backend?: SemanticBackend;
  private readonly defaultTimezone?: string;
  private readonly queryCache: SemanticQueryCache;
  private readonly cacheEnabledByDefault: boolean;
  private readonly cacheDefaults: ClientCacheDefaults;
  private readonly defaultCacheScope?: string;
  private readonly cacheKeySettings: ProtocolCacheKeySettings;

  constructor(options: CreateDatasetClientOptions) {
    if (!options.queryBuilder && !options.backend) {
      throw new Error('createDatasetClient requires either queryBuilder or backend.');
    }
    super({
      builderFactory: options.queryBuilder ?? {
        table() {
          throw new Error('This dataset client was created with a semantic backend, not a query builder.');
        },
        async rawQuery() {
          throw new Error('This dataset client was created with a semantic backend, not a query builder.');
        },
      },
    });
    const timezoneErrors = queryTimezoneErrors(options.timezone);
    if (timezoneErrors.length) throw new Error(timezoneErrors[0]);
    if (options.backend && options.timezone !== undefined) {
      throw new Error('Execution timezone requires the queryBuilder execution path.');
    }
    this.defaultTimezone = options.backend ? undefined : options.timezone ?? 'UTC';
    this.backend = options.backend;
    this.queryCache = new SemanticQueryCache(options.cache);
    this.cacheKeySettings = resolveProtocolCacheKeySettings(
      options.cache ?? {},
      options.cache?.store !== undefined,
    );
    this.cacheEnabledByDefault = (options.cache?.ttlMs ?? 0) > 0;
    this.defaultCacheScope = options.cache?.scope;
    // Kept so a dataset's declared ceiling can clamp the client default too; the
    // cache would otherwise fill a missing TTL from it after clamping has run.
    this.cacheDefaults = {
      ttlMs: options.cache?.ttlMs,
      staleWhileRevalidateMs: options.cache?.staleWhileRevalidateMs,
    };
  }

  private withTimezone<T extends DatasetQuery | MetricQuery>(query: T): T {
    return query.timezone !== undefined || this.defaultTimezone === undefined
      ? query : { ...query, timezone: this.defaultTimezone };
  }

  getCacheStats(): SemanticCacheStats {
    return this.queryCache.getStats();
  }

  clearCache(): Promise<boolean> {
    return this.queryCache.clear();
  }

  /**
   * True when this call can hit the cache — either the client has a default
   * TTL or the call opts in via `context.cache`. Skips signature building for
   * the common uncached path.
   */
  private isCacheable(context?: ExecutionContext): boolean {
    if (context?.abortSignal || context?.cache === false || context?.cache?.mode === 'bypass') {
      return false;
    }
    const builderOverride = context?.runtime?.builderFactory;
    if (
      builderOverride &&
      toQueryBuilderFactory(builderOverride) !== this.getBuilderFactory() &&
      context.cache?.scope == null
    ) {
      // A per-call builder override can point at a different data source; the
      // query signature alone cannot tell them apart, so caching is unsafe
      // unless the caller partitions entries with an explicit `cache.scope`.
      // Passing the client's own factory back in is not an override.
      return false;
    }
    if (context?.cache?.mode === 'refresh') {
      // Always reach the cache: it warns if refresh has no TTL to write under.
      return true;
    }
    if (context?.cache?.ttlMs != null) {
      return context.cache.ttlMs > 0;
    }
    return this.cacheEnabledByDefault;
  }

  /** The call's cache partition: its own `cache.scope`, else the client default. */
  private cacheScope(context?: ExecutionContext): string | undefined {
    if (context?.cache === false) return undefined;
    return context?.cache?.scope ?? this.defaultCacheScope;
  }

  planMetric(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): PlanNode {
    query = this.withTimezone(query);
    assertMetricHandle(metric);
    const validation = validateMetricQueryInput(metric, query, context);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }
    return buildMetricPlan(metric, query, context);
  }

  planDataset(
    ds: AnyDatasetInstance,
    query: DatasetQuery = {},
    context?: ExecutionContext,
  ): PlanNode {
    return buildDatasetPlan(ds, this.withTimezone(query), context);
  }

  /**
   * Execute a semantic target.
   */
  execute<
    TDataset extends DatasetInstance<any, any, any, any>,
    const TQuery extends DatasetQueryFor<TDataset> = DatasetQueryFor<TDataset>,
  >(
    target: TDataset,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<DatasetQueryResultFor<TDataset, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends DatasetInstance<any, any, any, TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: MetricRef<TDatasetName, TMetricName, any, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends DatasetInstance<any, any, any, TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: GrainedMetricRef<TDatasetName, TMetricName, any, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  execute<
    TDatasetName extends string,
    TMetricName extends string,
    TDataset extends TypedDataset<TDatasetName>,
    const TQuery extends MetricQueryFor<TDataset, TMetricName> = MetricQueryFor<TDataset, TMetricName>,
  >(
    target: TypedMetricRef<TDatasetName, TMetricName, TDataset> | TypedGrainedMetricRef<TDatasetName, TMetricName, TDataset>,
    query?: TQuery,
    context?: ExecutionContext,
  ): Promise<MetricResultFor<TDataset, TMetricName, TQuery>>;
  execute<TRow = Record<string, unknown>, TTarget extends SemanticTarget = SemanticTarget>(
    target: TTarget,
    query: SemanticQuery<TTarget> = {} as SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): Promise<SemanticResult<TTarget, TRow>> {
    // An async cache read must not let caller mutations change the query or
    // tenant after its key has been derived.
    query = this.withTimezone(structuredClone(query));
    context = snapshotExecutionContext(context);
    if (this.backend && query.timezone !== undefined) {
      throw new Error('Execution timezone requires the queryBuilder execution path.');
    }
    if (isDatasetInstance(target)) {
      return this.executeDataset<TRow>(
        target,
        query as DatasetQuery,
        context,
      ) as Promise<SemanticResult<TTarget, TRow>>;
    }

    return this.executeMetric<TRow>(
      target,
      query as MetricQuery,
      context,
    ) as Promise<SemanticResult<TTarget, TRow>>;
  }

  compileDataset<TDataset extends TypedDataset>(
    target: TDataset,
    query: DatasetQueryFor<TDataset> = {},
    context?: ExecutionContext,
  ): DatasetCompilation {
    if (this.backend) throw new Error('Dataset compilation requires the queryBuilder execution path.');
    if (!isDatasetInstance(target)) throw new Error('Dataset compilation requires a dataset target.');
    return prepareDatasetQuery(target, this.withTimezone(query as DatasetQuery), {
      builderFactory: this.resolveBuilderFactory(context),
      context,
    }).compilation;
  }

  toSQL<TTarget extends SemanticTarget>(
    target: TTarget,
    query: SemanticQuery<TTarget> = {} as SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): string {
    query = this.withTimezone(query);
    if (this.backend && query.timezone !== undefined) {
      throw new Error('Execution timezone requires the queryBuilder execution path.');
    }
    if (isDatasetInstance(target)) {
      return this.toDatasetSQL(target, query as DatasetQuery, context);
    }

    return super.toSQL(target, query as MetricQuery, context);
  }

  validate<TTarget extends SemanticTarget>(
    target: TTarget,
    query: SemanticQuery<TTarget> = {} as SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): ValidationResult {
    query = this.withTimezone(query);
    if (this.backend && query.timezone !== undefined) {
      return { valid: false, errors: ['Execution timezone requires the queryBuilder execution path.'] };
    }
    if (isDatasetInstance(target)) {
      return validateDatasetQuery(target, query as DatasetQuery, context);
    }

    return super.validate(target, query as MetricQuery, context);
  }

  private executeMetric<TRow>(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
    context?: ExecutionContext,
  ): Promise<MetricResult<TRow>> {
    const ds = getMetricRef(metric).dataset as AnyDatasetInstance;

    // Same ceiling and same cache policy as a dataset query: a metric is a
    // named query over the dataset, not a way around what it declared.
    const resultLimit = resolveResultLimit(query.limit, ds.limits);
    const boundedQuery: MetricQuery =
      resultLimit.limit === query.limit ? query : { ...query, limit: resultLimit.limit };
    const cacheRuntime = this.datasetCacheContext(ds, context);

    const run = (): Promise<MetricResult<TRow>> => {
      if (this.backend) {
        const validation = validateMetricQueryInput(metric, boundedQuery, context);
        if (!validation.valid) {
          throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
        }
        return (this.backend.execute<TRow>(
          this.planMetric(metric, boundedQuery, context),
          { abortSignal: context?.abortSignal },
        ) as Promise<MetricResult<TRow>>).then((result) => ({
          ...result,
          data: serializeSemanticMeasureValues(result.data, [getMetricRef(metric).name]),
        }));
      }

      return this.run<TRow>(metric, boundedQuery, context);
    };

    if (!this.isCacheable(cacheRuntime)) {
      return withResultLimit(run(), resultLimit.meta);
    }

    // Validate semantic rules before cache lookup so invalid queries and
    // missing tenant runtime cannot be served from cache. Avoid this.validate()
    // here because it dry-builds SQL, which is unnecessary on cache hits and
    // invalid for backend-only clients.
    const validation = validateMetricQueryInput(metric, boundedQuery, context);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }

    const key = metricCacheKey(
      this.cacheKeySettings, metric, boundedQuery, cacheRuntime, this.cacheScope(cacheRuntime),
    );
    if (key === undefined) {
      // No portable key for this call (see metricCacheKey): run uncached.
      return withResultLimit(run(), resultLimit.meta);
    }
    return withResultLimit(
      this.queryCache.through(key, run, cacheRuntime?.cache),
      resultLimit.meta,
    );
  }

  private executeDataset<TRow>(
    ds: AnyDatasetInstance,
    query: DatasetQuery,
    context?: ExecutionContext,
  ): Promise<DatasetQueryResult<TRow>> {
    const validation = this.validate(ds, query, context);
    if (!validation.valid) {
      throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
    }

    // Bound before the signature is built, so an unbounded call and an explicit
    // call at the ceiling produce the same rows and share one cache entry.
    const resultLimit = resolveResultLimit(query.limit, ds.limits);
    const boundedQuery: DatasetQuery =
      resultLimit.limit === query.limit ? query : { ...query, limit: resultLimit.limit };
    const cacheRuntime = this.datasetCacheContext(ds, context);

    const run = (): Promise<DatasetQueryResult<TRow>> => {
      if (this.backend) {
        rejectTimeMeasuresOnBackend(ds, boundedQuery);
        if (hasSelectedDerivedMeasure(ds, boundedQuery)) {
          throw new Error('Derived dataset measures require the queryBuilder execution path.');
        }
        if (boundedQuery.having?.length) {
          throw new Error('Dataset having conditions require the queryBuilder execution path.');
        }
        return (this.backend.execute<TRow>(
          this.planDataset(ds, boundedQuery, context),
          { abortSignal: context?.abortSignal },
        ) as Promise<DatasetQueryResult<TRow>>).then((result) => ({
          ...result,
          data: serializeSemanticMeasureValues(
            result.data,
            // Same measures either way; boundedQuery differs only in `limit`.
            boundedQuery.measures ?? baseMeasureNames(ds.measures),
          ),
        }));
      }
      return runDatasetQuery(ds, boundedQuery, {
        builderFactory: this.resolveBuilderFactory(context),
        context,
      }) as Promise<DatasetQueryResult<TRow>>;
    };

    if (!this.isCacheable(cacheRuntime)) {
      return withResultLimit(run(), resultLimit.meta);
    }

    // Annotated outside the cache: the ceiling is derived from the query, not
    // from the rows, so it must not be stored in or read back from an entry.
    const key = datasetCacheKey(
      this.cacheKeySettings, ds, boundedQuery, cacheRuntime, this.cacheScope(cacheRuntime),
    );
    if (key === undefined) {
      // No portable key for this call (see datasetCacheKey): run uncached.
      return withResultLimit(run(), resultLimit.meta);
    }
    return withResultLimit(
      this.queryCache.through(key, run, cacheRuntime?.cache),
      resultLimit.meta,
    );
  }

  /**
   * Folds the dataset's declared cache policy into the call's context, so both
   * the cacheability decision and the lookup see the same resolved TTL.
   */
  private datasetCacheContext(
    ds: AnyDatasetInstance,
    context?: ExecutionContext,
  ): ExecutionContext | undefined {
    const cache = resolveDatasetCacheRuntime(ds.cache, context?.cache, this.cacheDefaults);
    if (cache === context?.cache) {
      return context;
    }
    return { ...context, cache };
  }

  private toDatasetSQL(
    ds: AnyDatasetInstance,
    query: DatasetQuery,
    context?: ExecutionContext,
  ): string {
    return prepareDatasetQuery(ds, query, {
      builderFactory: this.resolveBuilderFactory(context),
      context,
    }, 'logical').compilation.sql;
  }
}

export function createDatasetClient(options: CreateDatasetClientOptions): DatasetClient {
  return new DatasetClientImpl(options);
}

export type { DatasetQueryExecutionOptions };
