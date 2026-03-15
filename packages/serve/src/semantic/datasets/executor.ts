/**
 * MetricExecutor — resolves metrics to SQL and executes them.
 *
 * Supports two modes:
 * 1. **Query builder** (recommended) — pass a `QueryBuilderFactoryLike` and the
 *    executor builds queries via the builder's fluent API, then calls `.execute()`.
 * 2. **Raw adapter** (deprecated) — pass a `MetricAdapter` with a `rawQuery` function
 *    and the executor generates SQL strings manually.
 *
 * The executor stays DB-agnostic via duck-typed protocol interfaces.
 */

import type {
  MetricRef,
  GrainedMetricRef,
  MetricQuery,
  MetricResult,
  MetricFilter,
  MetricContract,
  ExecutionContext,
  AggregationSpec,
  DerivedMetricSpec,
  DatasetInstance,
  TimeGrain,
  FormulaExpr,
} from './types.js';

import type {
  QueryBuilderLike,
  QueryBuilderFactoryLike,
} from './query-builder-protocol.js';

// =============================================================================
// ADAPTER INTERFACE (DB-agnostic) — deprecated, use QueryBuilderFactoryLike
// =============================================================================

/**
 * Minimal adapter that the MetricExecutor needs from the query builder.
 * The `createQueryBuilder` return from @hypequery/clickhouse satisfies this.
 *
 * @deprecated Pass `queryBuilder` (a `QueryBuilderFactoryLike`) to the executor instead.
 */
export interface MetricAdapter {
  rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

// =============================================================================
// TIME GRAIN SQL MAPPING
// =============================================================================

const GRAIN_FUNCTIONS: Record<TimeGrain, string> = {
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
};

// =============================================================================
// LEGACY SQL BUILDING HELPERS (used only by adapter path)
// =============================================================================

/** @deprecated Used only by legacy adapter path. */
function aggregationToSQL(spec: AggregationSpec, alias: string): string {
  switch (spec.aggregation) {
    case 'sum': return `SUM(${spec.field}) AS ${alias}`;
    case 'count': return `COUNT(${spec.field}) AS ${alias}`;
    case 'countDistinct': return `COUNT(DISTINCT ${spec.field}) AS ${alias}`;
    case 'avg': return `AVG(${spec.field}) AS ${alias}`;
    case 'min': return `MIN(${spec.field}) AS ${alias}`;
    case 'max': return `MAX(${spec.field}) AS ${alias}`;
    default: throw new Error(`Unknown aggregation type: ${(spec as AggregationSpec).aggregation}`);
  }
}

/** @deprecated Used only by legacy adapter path. */
const OPERATOR_SQL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
};

/** @deprecated Used only by legacy adapter path. */
function filterToSQL(filter: MetricFilter, params: unknown[]): string {
  if (filter.operator === 'in' || filter.operator === 'notIn') {
    const values = filter.value as unknown[];
    for (const v of values) {
      params.push(v);
    }
    const ph = values.map(() => '?').join(', ');
    const op = filter.operator === 'in' ? 'IN' : 'NOT IN';
    return `${filter.field} ${op} (${ph})`;
  }

  if (filter.operator === 'between') {
    const [lo, hi] = filter.value as [unknown, unknown];
    params.push(lo, hi);
    return `${filter.field} BETWEEN ? AND ?`;
  }

  const sqlOp = OPERATOR_SQL[filter.operator];
  if (!sqlOp) {
    throw new Error(`Unknown filter operator: ${filter.operator}`);
  }
  params.push(filter.value);
  return `${filter.field} ${sqlOp} ?`;
}

// =============================================================================
// VALIDATION
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateQuery(
  metric: MetricRef | GrainedMetricRef,
  query: MetricQuery,
): ValidationResult {
  const errors: string[] = [];
  const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
  const ds = ref.dataset;
  const fieldNames = Object.keys(ds.fields);

  // Validate dimensions
  for (const dim of query.dimensions ?? []) {
    if (!fieldNames.includes(dim)) {
      errors.push(`Unknown dimension "${dim}". Available: ${fieldNames.join(', ')}`);
    }
  }

  // Validate filters
  for (const filter of query.filters ?? []) {
    if (!fieldNames.includes(filter.field)) {
      errors.push(`Unknown filter field "${filter.field}". Available: ${fieldNames.join(', ')}`);
    }
  }

  // Validate grain requires timeKey
  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  // Validate limits
  if (ds.limits) {
    if (ds.limits.maxDimensions && (query.dimensions?.length ?? 0) > ds.limits.maxDimensions) {
      errors.push(`Too many dimensions (${query.dimensions?.length}). Max: ${ds.limits.maxDimensions}`);
    }
    if (ds.limits.maxFilters && (query.filters?.length ?? 0) > ds.limits.maxFilters) {
      errors.push(`Too many filters (${query.filters?.length}). Max: ${ds.limits.maxFilters}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// QUERY BUILDER HELPERS
// =============================================================================

function applyAggregation(qb: QueryBuilderLike, spec: AggregationSpec, alias: string): QueryBuilderLike {
  switch (spec.aggregation) {
    case 'sum': return qb.sum(spec.field, alias);
    case 'count': return qb.count(spec.field, alias);
    case 'countDistinct': return qb.countDistinct(spec.field, alias);
    case 'avg': return qb.avg(spec.field, alias);
    case 'min': return qb.min(spec.field, alias);
    case 'max': return qb.max(spec.field, alias);
    default: throw new Error(`Unknown aggregation type: ${(spec as AggregationSpec).aggregation}`);
  }
}

function appendOrderLimitOffset(
  qb: QueryBuilderLike,
  query: MetricQuery,
  grain: TimeGrain | undefined,
): QueryBuilderLike {
  if (query.orderBy && query.orderBy.length > 0) {
    for (const o of query.orderBy) {
      qb = qb.orderBy(o.field, o.direction.toUpperCase() as 'ASC' | 'DESC');
    }
  } else if (grain) {
    qb = qb.orderBy('period', 'ASC');
  }

  if (query.limit != null) qb = qb.limit(query.limit);
  if (query.offset != null) qb = qb.offset(query.offset);

  return qb;
}

// =============================================================================
// METRIC EXECUTOR
// =============================================================================

export interface MetricExecutorOptions {
  /** @deprecated Use `builderFactory` instead. */
  adapter?: MetricAdapter;
  /** Query builder factory — the recommended way to execute metrics. */
  builderFactory?: QueryBuilderFactoryLike;
}

export class MetricExecutor {
  private adapter?: MetricAdapter;
  private builderFactory?: QueryBuilderFactoryLike;

  constructor(options: MetricExecutorOptions) {
    this.adapter = options.adapter;
    this.builderFactory = options.builderFactory;
    if (!this.adapter && !this.builderFactory) {
      throw new Error('MetricExecutor requires either adapter or builderFactory');
    }
  }

  /**
   * Execute a metric query. Generates SQL, applies tenant/filter context, executes.
   */
  async run<T = Record<string, unknown>>(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): Promise<MetricResult<T>> {
    const validation = this.validate(metric, query);
    if (!validation.valid) {
      throw new Error(`Invalid metric query: ${validation.errors.join('; ')}`);
    }

    const start = Date.now();

    if (this.builderFactory) {
      return this.runViaBuilder<T>(metric, query, context, start);
    }

    // Legacy adapter path
    const { sql, params } = this.buildLegacySQL(metric, query, context);
    const data = await this.adapter!.rawQuery<T>(sql, params);
    const timingMs = Date.now() - start;

    return {
      data,
      meta: { sql, timingMs, tenant: context?.tenantId },
    };
  }

  /**
   * Generate SQL without executing.
   */
  toSQL(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): string {
    if (this.builderFactory) {
      const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
      const grain = metric.__type === 'grained_metric_ref' ? metric.grain : query.by ?? undefined;
      const spec = ref.spec;

      if (spec.__type === 'derived_metric_spec') {
        return this.buildDerivedSQLViaBuilder(ref, spec, query, grain, context).sql;
      }

      const builder = this.buildBaseQuery(ref, spec as AggregationSpec, ref.dataset, query, grain, context);
      return builder.toSQLWithParams().sql;
    }

    return this.buildLegacySQL(metric, query, context).sql;
  }

  /**
   * Validate a metric query against the metric's contract.
   */
  validate(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
  ): ValidationResult {
    return validateQuery(metric, query);
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
    const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
    const grain = metric.__type === 'grained_metric_ref' ? metric.grain : query.by ?? undefined;
    const spec = ref.spec;

    if (spec.__type === 'derived_metric_spec') {
      // Derived metrics: build CTE via builder, outer query via string, execute via rawQuery
      const { sql, params } = this.buildDerivedSQLViaBuilder(ref, spec, query, grain, context);
      const data = await this.builderFactory!.rawQuery<T>(sql, params);
      const timingMs = Date.now() - start;
      return { data, meta: { sql, timingMs, tenant: context?.tenantId } };
    }

    // Base metrics: fully use the builder's execute()
    const builder = this.buildBaseQuery(ref, spec as AggregationSpec, ref.dataset, query, grain, context);
    const { sql } = builder.toSQLWithParams();
    const data = await builder.execute() as T[];
    const timingMs = Date.now() - start;
    return { data, meta: { sql, timingMs, tenant: context?.tenantId } };
  }

  private buildBaseQuery(
    ref: MetricRef,
    spec: AggregationSpec,
    ds: DatasetInstance<any>,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): QueryBuilderLike {
    let qb: QueryBuilderLike = this.builderFactory!.table(ds.source);

    // Build select + groupBy parts
    const selectParts: string[] = [];
    const groupByParts: string[] = [];

    if (grain) {
      const fn = GRAIN_FUNCTIONS[grain];
      selectParts.push(`${fn}(${ds.timeKey}) AS period`);
      groupByParts.push('period');
    }

    for (const dim of query.dimensions ?? []) {
      selectParts.push(dim);
      groupByParts.push(dim);
    }

    if (selectParts.length > 0) {
      qb = qb.select(selectParts);
    }

    // Aggregation (appends to select, auto-sets groupBy on non-agg columns)
    qb = applyAggregation(qb, spec, ref.name);

    // Explicit groupBy (ensures period + dims are grouped even if aggregation auto-groupBy misses them)
    if (groupByParts.length > 0) {
      qb = qb.groupBy(groupByParts);
    }

    // Tenant auto-injection
    if (context?.tenantId && ds.tenantKey) {
      qb = qb.where(ds.tenantKey, 'eq', context.tenantId);
    }

    // User filters
    for (const filter of query.filters ?? []) {
      qb = qb.where(filter.field, filter.operator, filter.value);
    }

    // Order, limit, offset
    qb = appendOrderLimitOffset(qb, query, grain);

    return qb;
  }

  private buildDerivedSQLViaBuilder(
    ref: MetricRef,
    spec: DerivedMetricSpec,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const ds = ref.dataset;

    // Build the CTE inner query using the builder
    let cteBuilder: QueryBuilderLike = this.builderFactory!.table(ds.source);

    const selectParts: string[] = [];
    const groupByParts: string[] = [];

    if (grain) {
      const fn = GRAIN_FUNCTIONS[grain];
      selectParts.push(`${fn}(${ds.timeKey}) AS period`);
      groupByParts.push('period');
    }

    for (const dim of query.dimensions ?? []) {
      selectParts.push(dim);
      groupByParts.push(dim);
    }

    if (selectParts.length > 0) {
      cteBuilder = cteBuilder.select(selectParts);
    }

    // Base aggregations
    const refAliases: Record<string, string> = {};
    for (const [alias, baseMetric] of Object.entries(spec.uses)) {
      const baseSpec = baseMetric.spec;
      if (baseSpec.__type !== 'aggregation_spec') {
        throw new Error(`Derived metric "${ref.name}" references non-base metric "${alias}".`);
      }
      cteBuilder = applyAggregation(cteBuilder, baseSpec, alias);
      refAliases[alias] = alias;
    }

    if (groupByParts.length > 0) {
      cteBuilder = cteBuilder.groupBy(groupByParts);
    }

    // Filters on CTE
    if (context?.tenantId && ds.tenantKey) {
      cteBuilder = cteBuilder.where(ds.tenantKey, 'eq', context.tenantId);
    }
    for (const filter of query.filters ?? []) {
      cteBuilder = cteBuilder.where(filter.field, filter.operator, filter.value);
    }

    const { sql: cteSql, parameters: cteParams } = cteBuilder.toSQLWithParams();

    // Outer query: trivial SELECT from the CTE — stays as string concat
    // because table('base') would fail schema typing
    const outerSelectParts: string[] = [];
    if (grain) outerSelectParts.push('period');
    for (const dim of query.dimensions ?? []) {
      outerSelectParts.push(dim);
    }

    const formulaExpr = spec.formula(refAliases);
    outerSelectParts.push(`${formulaExpr.toSQL()} AS ${ref.name}`);

    for (const alias of Object.keys(spec.uses)) {
      outerSelectParts.push(alias);
    }

    let sql = `WITH base AS (${cteSql}) SELECT ${outerSelectParts.join(', ')} FROM base`;

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      const orderParts = query.orderBy.map(o =>
        `${o.field} ${o.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    } else if (grain) {
      sql += ' ORDER BY period';
    }

    if (query.limit != null) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset != null) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params: cteParams };
  }

  // ---------------------------------------------------------------------------
  // Legacy adapter path (deprecated)
  // ---------------------------------------------------------------------------

  /** @deprecated Use builderFactory path instead. */
  private buildLegacySQL(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
    const grain = metric.__type === 'grained_metric_ref'
      ? metric.grain
      : query.by ?? undefined;
    const ds = ref.dataset;
    const spec = ref.spec;

    if (spec.__type === 'derived_metric_spec') {
      return this.buildLegacyDerivedSQL(ref, spec, query, grain, context);
    }

    return this.buildLegacyBaseSQL(ref, spec, ds, query, grain, context);
  }

  /** @deprecated */
  private buildLegacyBaseSQL(
    ref: MetricRef,
    spec: AggregationSpec,
    ds: DatasetInstance<any>,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const selectParts: string[] = [];
    const groupByParts: string[] = [];

    // Time grain
    if (grain) {
      const fn = GRAIN_FUNCTIONS[grain];
      selectParts.push(`${fn}(${ds.timeKey}) AS period`);
      groupByParts.push('period');
    }

    // Dimensions
    for (const dim of query.dimensions ?? []) {
      selectParts.push(dim);
      groupByParts.push(dim);
    }

    // Aggregation
    selectParts.push(aggregationToSQL(spec, ref.name));

    // WHERE
    const whereParts: string[] = [];

    // Tenant auto-injection
    if (context?.tenantId && ds.tenantKey) {
      whereParts.push(`${ds.tenantKey} = ?`);
      params.push(context.tenantId);
    }

    // User filters
    for (const filter of query.filters ?? []) {
      whereParts.push(filterToSQL(filter, params));
    }

    // Build SQL
    let sql = `SELECT ${selectParts.join(', ')} FROM ${ds.source}`;

    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    if (groupByParts.length > 0) {
      sql += ` GROUP BY ${groupByParts.join(', ')}`;
    }

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      const orderParts = query.orderBy.map(o =>
        `${o.field} ${o.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    } else if (grain) {
      sql += ' ORDER BY period';
    }

    if (query.limit != null) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset != null) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params };
  }

  /** @deprecated */
  private buildLegacyDerivedSQL(
    ref: MetricRef,
    spec: DerivedMetricSpec,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const ds = ref.dataset;
    const params: unknown[] = [];

    // Collect all base metrics from `uses`
    const baseSelectParts: string[] = [];
    const groupByParts: string[] = [];

    // Time grain in CTE
    if (grain) {
      const fn = GRAIN_FUNCTIONS[grain];
      baseSelectParts.push(`${fn}(${ds.timeKey}) AS period`);
      groupByParts.push('period');
    }

    // Dimensions in CTE
    for (const dim of query.dimensions ?? []) {
      baseSelectParts.push(dim);
      groupByParts.push(dim);
    }

    // Base aggregations
    const refAliases: Record<string, string> = {};
    for (const [alias, baseMetric] of Object.entries(spec.uses)) {
      const baseSpec = baseMetric.spec;
      if (baseSpec.__type !== 'aggregation_spec') {
        throw new Error(`Derived metric "${ref.name}" references non-base metric "${alias}".`);
      }
      baseSelectParts.push(aggregationToSQL(baseSpec, alias));
      refAliases[alias] = alias;
    }

    // WHERE for CTE
    const whereParts: string[] = [];
    if (context?.tenantId && ds.tenantKey) {
      whereParts.push(`${ds.tenantKey} = ?`);
      params.push(context.tenantId);
    }
    for (const filter of query.filters ?? []) {
      whereParts.push(filterToSQL(filter, params));
    }

    // Build CTE
    let cteSql = `SELECT ${baseSelectParts.join(', ')} FROM ${ds.source}`;
    if (whereParts.length > 0) {
      cteSql += ` WHERE ${whereParts.join(' AND ')}`;
    }
    if (groupByParts.length > 0) {
      cteSql += ` GROUP BY ${groupByParts.join(', ')}`;
    }

    // Outer SELECT
    const outerSelectParts: string[] = [];
    if (grain) outerSelectParts.push('period');
    for (const dim of query.dimensions ?? []) {
      outerSelectParts.push(dim);
    }

    // Apply formula
    const formulaExpr = spec.formula(refAliases);
    outerSelectParts.push(`${formulaExpr.toSQL()} AS ${ref.name}`);

    // Also include base metric columns in outer select
    for (const alias of Object.keys(spec.uses)) {
      outerSelectParts.push(alias);
    }

    let sql = `WITH base AS (${cteSql}) SELECT ${outerSelectParts.join(', ')} FROM base`;

    // ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      const orderParts = query.orderBy.map(o =>
        `${o.field} ${o.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    } else if (grain) {
      sql += ' ORDER BY period';
    }

    if (query.limit != null) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset != null) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params };
  }
}
