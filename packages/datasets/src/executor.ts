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
  FieldType,
} from './types.js';

import type {
  QueryBuilderLike,
  QueryBuilderFactoryLike,
} from './query-builder-protocol.js';

import { validateSQLIdentifier } from './sql-utils.js';
import { validateFilterValue, matchesFieldType, type ValidationResult } from './validation.js';
import {
  applyAggregationSpec,
  appendOrderLimitOffset,
  buildDimensionSelectionPlan,
  resolveFilterField,
  resolveTenantFilterColumn,
} from './query-planner.js';

// =============================================================================
// VALIDATION
// =============================================================================


function validateQuery(
  metric: MetricRef | GrainedMetricRef,
  query: MetricQuery,
): ValidationResult {
  const errors: string[] = [];
  const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
  const ds = ref.dataset;
  const dimensionNames = Object.keys(ds.dimensions);
  const filterNames = Object.keys(ds.filters).length > 0
    ? Object.keys(ds.filters)
    : dimensionNames;
  const grain = metric.__type === 'grained_metric_ref' ? metric.grain : query.by;
  const orderableFields = new Set<string>([
    ...(query.dimensions ?? []),
    ref.name,
    ...(grain ? ['period'] : []),
  ]);

  if (metric.__type === 'grained_metric_ref' && query.by && query.by !== metric.grain) {
    errors.push(
      `Metric "${ref.name}" is already grained by "${metric.grain}" and cannot be queried with by="${query.by}".`,
    );
  }

  // Validate dimensions
  for (const dim of query.dimensions ?? []) {
    if (!dimensionNames.includes(dim)) {
      errors.push(`Unknown dimension "${dim}". Available: ${dimensionNames.join(', ')}`);
    }
  }

  // Validate filters
  for (const filter of query.filters ?? []) {
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
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// METRIC EXECUTOR
// =============================================================================

export interface MetricExecutorOptions {
  /** Query builder factory for executing metrics. */
  builderFactory: QueryBuilderFactoryLike;
}

export class MetricExecutor {
  private builderFactory: QueryBuilderFactoryLike;

  constructor(options: MetricExecutorOptions) {
    this.builderFactory = options.builderFactory;
  }

  getBuilderFactory(): QueryBuilderFactoryLike {
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
    const validation = this.validate(metric, query);
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
    const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
    const grain = metric.__type === 'grained_metric_ref' ? metric.grain : query.by ?? undefined;
    const spec = ref.spec;

    if (spec.__type === 'derived_metric_spec') {
      return this.buildDerivedSQLViaBuilder(ref, spec, query, grain, context).sql;
    }

    const builder = this.buildBaseQuery(ref, spec as AggregationSpec, ref.dataset, query, grain, context);
    return builder.toSQLWithParams().sql;
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
    const activeBuilderFactory = context?.runtime?.builderFactory ?? this.builderFactory;

    if (spec.__type === 'derived_metric_spec') {
      // Derived metrics: build CTE via builder, outer query via string, execute via rawQuery
      const { sql, params } = this.buildDerivedSQLViaBuilder(ref, spec, query, grain, context);
      const data = await activeBuilderFactory.rawQuery<T>(sql, params);
      const timingMs = Date.now() - start;
      return { data, meta: { sql, timingMs, tenant: context?.runtime?.tenant?.id } };
    }

    // Base metrics: fully use the builder's execute()
    const builder = this.buildBaseQuery(ref, spec as AggregationSpec, ref.dataset, query, grain, context);
    const { sql } = builder.toSQLWithParams();
    const data = await builder.execute() as T[];
    const timingMs = Date.now() - start;
    return { data, meta: { sql, timingMs, tenant: context?.runtime?.tenant?.id } };
  }

  private buildBaseQuery(
    ref: MetricRef,
    spec: AggregationSpec,
    ds: DatasetInstance,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): QueryBuilderLike {
    const activeBuilderFactory = context?.runtime?.builderFactory ?? this.builderFactory;
    let qb: QueryBuilderLike = activeBuilderFactory.table(ds.source);
    const { selectParts, groupByParts } = buildDimensionSelectionPlan(
      ds,
      query.dimensions ?? [],
      grain,
    );

    if (selectParts.length > 0) {
      qb = qb.select(selectParts);
    }

    // Aggregation (appends to select, auto-sets groupBy on non-agg columns)
    qb = applyAggregationSpec(qb, ds, spec, ref.name);

    // Explicit groupBy (ensures period + dims are grouped even if aggregation auto-groupBy misses them)
    if (groupByParts.length > 0) {
      qb = qb.groupBy(groupByParts);
    }

    // Tenant auto-injection
    const tenantColumn = resolveTenantFilterColumn(ds, context);
    const tenantId = context?.runtime?.tenant?.id;
    const tenantHandledByBuilder = context?.runtime?.tenant?.handledByBuilder === true;
    if (tenantId && tenantColumn && !tenantHandledByBuilder) {
      qb = qb.where(tenantColumn, 'eq', tenantId);
    }

    // User filters
    for (const filter of query.filters ?? []) {
      const resolvedField = resolveFilterField(ds, filter.field);
      qb = qb.where(resolvedField, filter.operator, filter.value);
    }

    // Order, limit, offset
    qb = appendOrderLimitOffset(qb, query.orderBy, grain, query.limit, query.offset);

    return qb;
  }

  private buildDerivedSQLViaBuilder(
    ref: MetricRef,
    spec: DerivedMetricSpec,
    query: MetricQuery,
    grain: TimeGrain | undefined,
    context?: ExecutionContext,
  ): { sql: string; params: unknown[] } {
    const activeBuilderFactory = context?.runtime?.builderFactory ?? this.builderFactory;
    const ds = ref.dataset;

    // Build the CTE inner query using the builder
    let cteBuilder: QueryBuilderLike = activeBuilderFactory.table(ds.source);
    const { selectParts, groupByParts } = buildDimensionSelectionPlan(
      ds,
      query.dimensions ?? [],
      grain,
    );

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
      cteBuilder = applyAggregationSpec(cteBuilder, ds, baseSpec, alias);
      refAliases[alias] = alias;
    }

    if (groupByParts.length > 0) {
      cteBuilder = cteBuilder.groupBy(groupByParts);
    }

    // Filters on CTE
    const tenantColumn = resolveTenantFilterColumn(ds, context);
    const tenantId = context?.runtime?.tenant?.id;
    const tenantHandledByBuilder = context?.runtime?.tenant?.handledByBuilder === true;
    if (tenantId && tenantColumn && !tenantHandledByBuilder) {
      cteBuilder = cteBuilder.where(tenantColumn, 'eq', tenantId);
    }
    for (const filter of query.filters ?? []) {
      const resolvedField = resolveFilterField(ds, filter.field);
      cteBuilder = cteBuilder.where(resolvedField, filter.operator, filter.value);
    }

    const { sql: cteSql, parameters: cteParams } = cteBuilder.toSQLWithParams();

    // Outer query: trivial SELECT from the CTE — stays as string concat
    // because table('base') would fail schema typing
    const outerSelectParts: string[] = [];
    if (grain) outerSelectParts.push('period');
    for (const dim of query.dimensions ?? []) {
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
