/**
 * Semantic dataset client internals.
 *
 * Public callers use `createDatasetClient(...).execute(...)`. The implementation
 * stays database-agnostic via query-builder and backend protocol interfaces.
 */

import type {
  MetricRef,
  GrainedMetricRef,
  MetricQuery,
  MetricQueryFor,
  MetricResult,
  MetricResultFor,
  DatasetQuery,
  DatasetQueryFor,
  DatasetQueryResult,
  DatasetQueryResultFor,
  ExecutionContext,
  AggregationSpec,
  DerivedMetricSpec,
  AnyDatasetInstance,
  DatasetInstance,
  TimeGrain,
} from './types.js';

import type {
  QueryBuilderLike,
  QueryBuilderFactoryLike,
  QueryBuilderFactoryInput,
} from './query-builder-protocol.js';
import { toQueryBuilderFactory } from './query-builder-protocol.js';
import type {
  PlanNode,
  SemanticBackend,
} from './semantic-plan.js';

import { quoteSQLIdentifier, validateSQLIdentifier } from './sql-utils.js';
import { SUPPORTED_TIME_GRAINS, isSupportedTimeGrain } from './constants.js';
import { validateFilterValue, type ValidationResult } from './validation.js';
import {
  applyAggregationSpec,
  appendOrderLimitOffset,
  buildDimensionSelectionPlan,
  resolveFilterField,
  resolveTenantFilterColumn,
} from './query-planner.js';
import {
  assertMetricHandle,
  getMetricGrain,
  getMetricRef,
  isTenantScopedFilter,
  type MetricHandle,
} from './utils/metric-handle.js';
import { validateDerivedCteGrouping } from './utils/derived-cte-validation.js';
import {
  buildDatasetQueryBuilder,
  runDatasetQuery,
  validateDatasetQuery,
  type DatasetQueryExecutionOptions,
} from './dataset-query.js';
import {
  buildDatasetPlan,
  buildMetricPlan,
} from './semantic-planner.js';
import {
  getRuntimeTenantId,
  getRuntimeTenantPredicate,
  validateTenantRuntime,
} from './utils/tenant-runtime.js';
import { applyPagination, overfetchLimit } from './utils/pagination.js';
import {
  SemanticQueryCache,
  type SemanticCacheOptions,
} from './cache/semantic-query-cache.js';
import {
  buildDatasetQuerySignature,
  buildMetricQuerySignature,
} from './cache/query-signature.js';
import { isQualifiedField, resolveQualifiedField } from './utils/relationship-fields.js';
import { validateQualifiedFilter } from './utils/relationship-validation.js';
import {
  applyRelationshipJoins,
  buildRelationshipBuilderContext,
  qualifyBaseColumn,
} from './utils/relationship-builder-plan.js';

function validateQuery(
  metric: MetricHandle,
  query: MetricQuery,
  context?: ExecutionContext,
): ValidationResult {
  const errors: string[] = [];
  const ref = getMetricRef(metric);
  const ds = ref.dataset;
  const dimensionNames = Object.keys(ds.dimensions);
  const filterNames = Object.keys(ds.filters).length > 0
    ? Object.keys(ds.filters)
    : dimensionNames;
  const grain = getMetricGrain(metric, query);
  const orderableFields = new Set<string>([
    ...(query.dimensions ?? []),
    ref.name,
    ...(grain ? ['period'] : []),
  ]);

  const tenantRuntimeError = validateTenantRuntime(ds, context);
  if (tenantRuntimeError) {
    errors.push(tenantRuntimeError);
  }

  if (metric.__type === 'grained_metric_ref' && query.by && query.by !== metric.grain) {
    errors.push(
      `Metric "${ref.name}" is already grained by "${metric.grain}" and cannot be queried with by="${query.by}".`,
    );
  }

  // Validate dimensions
  for (const dim of query.dimensions ?? []) {
    if (isQualifiedField(dim)) {
      const resolution = resolveQualifiedField(ds, dim);
      if (resolution?.error) {
        errors.push(resolution.error);
      }
      continue;
    }
    if (!dimensionNames.includes(dim)) {
      errors.push(`Unknown dimension "${dim}". Available: ${dimensionNames.join(', ')}`);
    }
  }

  // Validate filters
  for (const filter of query.filters ?? []) {
    if (isQualifiedField(filter.field)) {
      const filterError = validateQualifiedFilter(ds, filter, context);
      if (filterError) {
        errors.push(filterError);
      }
      continue;
    }
    if (!filterNames.includes(filter.field)) {
      errors.push(`Unknown filter field "${filter.field}". Available: ${filterNames.join(', ')}`);
      continue;
    }

    const filterDefinition = ds.filters[filter.field];
    if (filterDefinition?.operators && !filterDefinition.operators.includes(filter.operator)) {
      errors.push(
        `Filter "${filter.field}" does not allow operator "${filter.operator}". Allowed: ${filterDefinition.operators.join(', ')}`,
      );
      continue;
    }

    const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
    if (isTenantScopedFilter(ds, filter, context)) {
      errors.push(
        `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
      );
      continue;
    }

    const fieldType = ds.dimensions[resolvedField]?.fieldType;
    if (fieldType) {
      const filterError = validateFilterValue(filter, fieldType);
      if (filterError) {
        errors.push(filterError);
      }
    }
  }

  // Validate order by fields against the metric output shape
  for (const order of query.orderBy ?? []) {
    if (!orderableFields.has(order.field)) {
      errors.push(
        `Unknown orderBy field "${order.field}". Available: ${Array.from(orderableFields).join(', ')}`,
      );
    }
  }

  // Validate grain requires timeKey
  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  // Validate grain is one the planner can bucket on
  if (query.by && !isSupportedTimeGrain(query.by)) {
    errors.push(`Unsupported time grain "${query.by}". Supported: ${SUPPORTED_TIME_GRAINS.join(', ')}`);
  }

  if (query.limit != null && (!Number.isInteger(query.limit) || query.limit < 0)) {
    errors.push(`Invalid limit: expected a non-negative integer.`);
  }

  if (query.offset != null && (!Number.isInteger(query.offset) || query.offset < 0)) {
    errors.push(`Invalid offset: expected a non-negative integer.`);
  }

  // Validate limits
  if (ds.limits) {
    if (ds.limits.maxDimensions && (query.dimensions?.length ?? 0) > ds.limits.maxDimensions) {
      errors.push(`Too many dimensions (${query.dimensions?.length}). Max: ${ds.limits.maxDimensions}`);
    }
    if (ds.limits.maxMeasures && 1 > ds.limits.maxMeasures) {
      errors.push(`Too many measures (1). Max: ${ds.limits.maxMeasures}`);
    }
    if (ds.limits.maxFilters && (query.filters?.length ?? 0) > ds.limits.maxFilters) {
      errors.push(`Too many filters (${query.filters?.length}). Max: ${ds.limits.maxFilters}`);
    }
    if (ds.limits.maxResultSize && query.limit != null && query.limit > ds.limits.maxResultSize) {
      errors.push(`Too many results requested (${query.limit}). Max: ${ds.limits.maxResultSize}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function isDatasetInstance(target: unknown): target is AnyDatasetInstance {
  return !!target && typeof target === 'object' && '__type' in target && target.__type === 'dataset';
}

// =============================================================================
// DATASET CLIENT
// =============================================================================

export interface MetricQueryEngineOptions {
  /** Query builder factory for executing metrics. */
  builderFactory: QueryBuilderFactoryInput;
}

export interface CreateDatasetClientOptions {
  /** Query builder factory for executing semantic metric and dataset queries. */
  queryBuilder?: QueryBuilderFactoryInput;
  /** Semantic backend for executing neutral semantic plans. */
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

/** Resolves the per-call builder override, adapted to the call contract. */
function resolveBuilderFactory(
  context: ExecutionContext | undefined,
  fallback: QueryBuilderFactoryLike,
): QueryBuilderFactoryLike {
  const override = context?.runtime?.builderFactory;
  return override ? toQueryBuilderFactory(override) : fallback;
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
  execute<TRow = Record<string, unknown>, TTarget extends SemanticTarget = SemanticTarget>(
    target: TTarget,
    query?: SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): Promise<SemanticResult<TTarget, TRow>>;
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
}

export class MetricQueryEngine {
  private builderFactory: QueryBuilderFactoryLike;

  constructor(options: MetricQueryEngineOptions) {
    this.builderFactory = toQueryBuilderFactory(options.builderFactory);
  }

  protected getBuilderFactory(): QueryBuilderFactoryLike {
    return this.builderFactory;
  }

  /**
   * Execute a metric query. Generates SQL, applies tenant/filter context, executes.
   */
  async run<T = Record<string, unknown>>(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): Promise<MetricResult<T>> {
    assertMetricHandle(metric);
    const validation = this.validate(metric, query, context);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }

    const start = Date.now();
    return this.runViaBuilder<T>(metric, query, context, start);
  }

  /**
   * Generate SQL without executing.
   */
  toSQL(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): string {
    assertMetricHandle(metric);
    const validation = this.validate(metric, query, context);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }

    const ref = getMetricRef(metric);
    const grain = getMetricGrain(metric, query);
    const spec = ref.spec;

    if (spec.__type === 'derived_metric_spec') {
      return this.buildDerivedSQLViaBuilder(ref, spec, query, grain, context).sql;
    }

    const builder = this.buildBaseQuery(ref, spec, ref.dataset, query, grain, context);
    return builder.toSQLWithParams().sql;
  }

  /**
   * Validate a metric query against the metric's contract.
   */
  validate(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
    context?: ExecutionContext,
  ): ValidationResult {
    assertMetricHandle(metric);

    const queryValidation = validateQuery(metric, query, context);
    if (!queryValidation.valid) {
      return queryValidation;
    }

    const ref = getMetricRef(metric);
    const grain = getMetricGrain(metric, query);

    try {
      if (ref.spec.__type === 'derived_metric_spec') {
        this.buildDerivedSQLViaBuilder(ref, ref.spec, query, grain, context);
      } else {
        this.buildBaseQuery(ref, ref.spec, ref.dataset, query, grain, context).toSQLWithParams();
      }
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    return queryValidation;
  }

  // ---------------------------------------------------------------------------
  // Query builder path
  // ---------------------------------------------------------------------------

  private async runViaBuilder<T>(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
    context: ExecutionContext | undefined,
    start: number,
  ): Promise<MetricResult<T>> {
    const ref = getMetricRef(metric);
    const grain = getMetricGrain(metric, query);
    const spec = ref.spec;
    const activeBuilderFactory = resolveBuilderFactory(context, this.builderFactory);

    // Over-fetch one row so we can report `hasMore` without a count query.
    const buildQuery = { ...query, limit: overfetchLimit(query.limit) };

    if (spec.__type === 'derived_metric_spec') {
      // Derived metrics: build CTE via builder, outer query via string, execute via rawQuery
      const { sql, params } = this.buildDerivedSQLViaBuilder(ref, spec, buildQuery, grain, context);
      const rows = await activeBuilderFactory.rawQuery<T>(sql, params);
      const timingMs = Date.now() - start;
      const { data, pagination } = applyPagination(rows, query.limit, query.offset);
      return { data, meta: { sql, timingMs, tenant: getRuntimeTenantId(context), rowCount: data.length, pagination } };
    }

    // Base metrics: fully use the builder's execute()
    const builder = this.buildBaseQuery(ref, spec, ref.dataset, buildQuery, grain, context);
    const { sql } = builder.toSQLWithParams();
    const rows = await builder.execute<T>();
    const timingMs = Date.now() - start;
    const { data, pagination } = applyPagination(rows, query.limit, query.offset);
    return { data, meta: { sql, timingMs, tenant: getRuntimeTenantId(context), rowCount: data.length, pagination } };
  }

  private buildBaseQuery(
    ref: MetricRef,
    spec: AggregationSpec,
    ds: AnyDatasetInstance,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): QueryBuilderLike {
    const activeBuilderFactory = resolveBuilderFactory(context, this.builderFactory);
    const joinCtx = buildRelationshipBuilderContext(ds, query, context);
    let qb: QueryBuilderLike = activeBuilderFactory.table(ds.source);
    qb = applyRelationshipJoins(qb, joinCtx);
    const { selectParts, groupByParts } = buildDimensionSelectionPlan(
      ds,
      query.dimensions ?? [],
      grain,
      joinCtx,
    );

    if (selectParts.length > 0) {
      qb = qb.select(selectParts);
    }

    // Aggregation (appends to select, auto-sets groupBy on non-agg columns)
    qb = applyAggregationSpec(qb, ds, spec, ref.name, joinCtx);

    // Explicit groupBy (ensures period + dims are grouped even if aggregation auto-groupBy misses them)
    if (groupByParts.length > 0) {
      qb = qb.groupBy(groupByParts);
    }

    // Tenant auto-injection
    const tenantColumn = resolveTenantFilterColumn(ds, context);
    const tenantPredicate = getRuntimeTenantPredicate(context);
    if (tenantPredicate && tenantColumn) {
      qb = qb.where(qualifyBaseColumn(joinCtx, tenantColumn), tenantPredicate.operator, tenantPredicate.value);
    }

    // User filters
    for (const filter of query.filters ?? []) {
      if (isTenantScopedFilter(ds, filter, context)) {
        throw new Error(
          `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
        );
      }
      const resolvedField = resolveFilterField(ds, filter.field, joinCtx);
      qb = qb.where(resolvedField, filter.operator, filter.value);
    }

    // Order, limit, offset
    qb = appendOrderLimitOffset(qb, query.orderBy, grain, query.limit, query.offset, joinCtx);

    return qb;
  }

  private buildDerivedSQLViaBuilder(
    ref: MetricRef,
    spec: DerivedMetricSpec,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const activeBuilderFactory = resolveBuilderFactory(context, this.builderFactory);
    const ds = ref.dataset;
    const joinCtx = buildRelationshipBuilderContext(ds, query, context);

    // Build the CTE inner query using the builder
    let cteBuilder: QueryBuilderLike = activeBuilderFactory.table(ds.source);
    cteBuilder = applyRelationshipJoins(cteBuilder, joinCtx);
    const { selectParts, groupByParts } = buildDimensionSelectionPlan(
      ds,
      query.dimensions ?? [],
      grain,
      joinCtx,
    );

    if (selectParts.length > 0) {
      cteBuilder = cteBuilder.select(selectParts);
    }

    // Base aggregations
    const refAliases: Record<string, string> = {};
    const aggregateAliases: string[] = [];
    for (const [alias, baseMetric] of Object.entries(spec.uses)) {
      const baseSpec = baseMetric.spec;
      if (baseSpec.__type !== 'aggregation_spec') {
        throw new Error(`Derived metric "${ref.name}" references non-base metric "${alias}".`);
      }
      cteBuilder = applyAggregationSpec(cteBuilder, ds, baseSpec, alias, joinCtx);
      refAliases[alias] = alias;
      aggregateAliases.push(alias);
    }

    if (groupByParts.length > 0) {
      cteBuilder = cteBuilder.groupBy(groupByParts);
    }

    // Filters on CTE
    const tenantColumn = resolveTenantFilterColumn(ds, context);
    const tenantPredicate = getRuntimeTenantPredicate(context);
    if (tenantPredicate && tenantColumn) {
      cteBuilder = cteBuilder.where(qualifyBaseColumn(joinCtx, tenantColumn), tenantPredicate.operator, tenantPredicate.value);
    }
    for (const filter of query.filters ?? []) {
      if (isTenantScopedFilter(ds, filter, context)) {
        throw new Error(
          `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
        );
      }
      const resolvedField = resolveFilterField(ds, filter.field, joinCtx);
      cteBuilder = cteBuilder.where(resolvedField, filter.operator, filter.value);
    }

    const { sql: cteSql, parameters: cteParams } = cteBuilder.toSQLWithParams();
    const groupingErrors = validateDerivedCteGrouping(cteSql, aggregateAliases, groupByParts);
    if (groupingErrors.length > 0) {
      throw new Error(groupingErrors.join('; '));
    }

    // Outer query: trivial SELECT from the CTE — stays as string concat
    // because table('base') would fail schema typing
    const outerSelectParts: string[] = [];
    if (grain) outerSelectParts.push('period');
    for (const dim of query.dimensions ?? []) {
      // Joined dimensions surface from the CTE under their quoted qualified alias.
      if (joinCtx && isQualifiedField(dim)) {
        outerSelectParts.push(quoteSQLIdentifier(dim));
        continue;
      }
      validateSQLIdentifier(dim, 'dimension name');
      outerSelectParts.push(dim);
    }

    const formulaExpr = spec.formula(refAliases);
    validateSQLIdentifier(ref.name, 'metric name');
    outerSelectParts.push(`${formulaExpr.toSQL()} AS ${ref.name}`);

    let sql = `WITH base AS (${cteSql}) SELECT ${outerSelectParts.join(', ')} FROM base`;

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      const orderParts = query.orderBy.map(o => {
        if (joinCtx && isQualifiedField(o.field)) {
          return `${quoteSQLIdentifier(o.field)} ${o.direction.toUpperCase()}`;
        }
        validateSQLIdentifier(o.field, 'order by field');
        return `${o.field} ${o.direction.toUpperCase()}`;
      });
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    } else if (grain) {
      sql += ' ORDER BY period';
    }

    if (query.limit != null) {
      // Ensure limit is a safe integer
      const limit = Math.floor(Math.abs(query.limit));
      sql += ` LIMIT ${limit}`;
    }
    if (query.offset != null) {
      // Ensure offset is a safe integer
      const offset = Math.floor(Math.abs(query.offset));
      sql += ` OFFSET ${offset}`;
    }

    return { sql, params: cteParams };
  }
}

export class DatasetClientImpl extends MetricQueryEngine implements DatasetClient {
  private backend?: SemanticBackend;
  private readonly queryCache: SemanticQueryCache;
  private readonly cacheEnabledByDefault: boolean;
  private readonly defaultCacheScope?: string;

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
    this.backend = options.backend;
    this.queryCache = new SemanticQueryCache(options.cache);
    this.cacheEnabledByDefault = (options.cache?.ttlMs ?? 0) > 0;
    this.defaultCacheScope = options.cache?.scope;
  }

  /**
   * True when this call can hit the cache — either the client has a default
   * TTL or the call opts in via `context.cache`. Skips signature building for
   * the common uncached path.
   */
  private isCacheable(context?: ExecutionContext): boolean {
    if (context?.cache === false || context?.cache?.mode === 'bypass') {
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

  /**
   * Context used for cache-key building: fills in the client-level default
   * `cache.scope` unless the call sets its own, so clients sharing a custom
   * store can be namespaced apart.
   */
  private signatureContext(context?: ExecutionContext): ExecutionContext | undefined {
    if (this.defaultCacheScope === undefined) {
      return context;
    }
    if (context?.cache === false || context?.cache?.scope != null) {
      return context;
    }
    return { ...context, cache: { ...context?.cache, scope: this.defaultCacheScope } };
  }

  planMetric(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): PlanNode {
    assertMetricHandle(metric);
    const validation = validateQuery(metric, query, context);
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
    return buildDatasetPlan(ds, query, context);
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
  execute<TRow = Record<string, unknown>, TTarget extends SemanticTarget = SemanticTarget>(
    target: TTarget,
    query: SemanticQuery<TTarget> = {} as SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): Promise<SemanticResult<TTarget, TRow>> {
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

  toSQL<TTarget extends SemanticTarget>(
    target: TTarget,
    query: SemanticQuery<TTarget> = {} as SemanticQuery<TTarget>,
    context?: ExecutionContext,
  ): string {
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
    const run = (): Promise<MetricResult<TRow>> => {
      if (this.backend) {
        const validation = validateQuery(metric, query, context);
        if (!validation.valid) {
          throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
        }
        return this.backend.execute<TRow>(
          this.planMetric(metric, query, context),
        ) as Promise<MetricResult<TRow>>;
      }

      return this.run<TRow>(metric, query, context);
    };

    if (!this.isCacheable(context)) {
      return run();
    }

    // Validate semantic rules before cache lookup so invalid queries and
    // missing tenant runtime cannot be served from cache. Avoid this.validate()
    // here because it dry-builds SQL, which is unnecessary on cache hits and
    // invalid for backend-only clients.
    const validation = validateQuery(metric, query, context);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }

    return this.queryCache.through(
      buildMetricQuerySignature(metric, query, this.signatureContext(context)),
      run,
      context?.cache,
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

    const run = (): Promise<DatasetQueryResult<TRow>> => {
      if (this.backend) {
        return this.backend.execute<TRow>(
          this.planDataset(ds, query, context),
        ) as Promise<DatasetQueryResult<TRow>>;
      }
      return runDatasetQuery(ds, query, {
        builderFactory: resolveBuilderFactory(context, this.getBuilderFactory()),
        context,
      }) as Promise<DatasetQueryResult<TRow>>;
    };

    if (!this.isCacheable(context)) {
      return run();
    }

    return this.queryCache.through(
      buildDatasetQuerySignature(ds, query, this.signatureContext(context)),
      run,
      context?.cache,
    );
  }

  private toDatasetSQL(
    ds: AnyDatasetInstance,
    query: DatasetQuery,
    context?: ExecutionContext,
  ): string {
    const builder = buildDatasetQueryBuilder(ds, query, {
      builderFactory: resolveBuilderFactory(context, this.getBuilderFactory()),
      context,
    });
    return builder.toSQLWithParams().sql;
  }
}

export function createDatasetClient(options: CreateDatasetClientOptions): DatasetClient {
  return new DatasetClientImpl(options);
}

export type { DatasetQueryExecutionOptions };
