/**
 * MetricExecutor — resolves metrics to SQL and executes them.
 *
 * The executor does NOT generate SQL strings directly. It delegates to
 * a provided query builder (e.g., `createQueryBuilder` from @hypequery/clickhouse)
 * which handles parameterization, dialect, joins, CTEs, etc.
 *
 * The executor accepts a generic "adapter" interface so it stays DB-agnostic.
 * The @hypequery/clickhouse adapter satisfies this interface.
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

// =============================================================================
// ADAPTER INTERFACE (DB-agnostic)
// =============================================================================

/**
 * Minimal adapter that the MetricExecutor needs from the query builder.
 * The `createQueryBuilder` return from @hypequery/clickhouse satisfies this.
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
// SQL BUILDING HELPERS
// =============================================================================

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

const OPERATOR_SQL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
};

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
// METRIC EXECUTOR
// =============================================================================

export interface MetricExecutorOptions {
  adapter: MetricAdapter;
}

export class MetricExecutor {
  private adapter: MetricAdapter;

  constructor(options: MetricExecutorOptions) {
    this.adapter = options.adapter;
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
    const { sql, params } = this.buildSQL(metric, query, context);
    const data = await this.adapter.rawQuery<T>(sql, params);
    const timingMs = Date.now() - start;

    return {
      data,
      meta: {
        sql,
        timingMs,
        tenant: context?.tenantId,
      },
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
    return this.buildSQL(metric, query, context).sql;
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
  // Private SQL building
  // ---------------------------------------------------------------------------

  private buildSQL(
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
      return this.buildDerivedSQL(ref, spec, query, grain, context);
    }

    return this.buildBaseSQL(ref, spec, ds, query, grain, context);
  }

  private buildBaseSQL(
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

  private buildDerivedSQL(
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
