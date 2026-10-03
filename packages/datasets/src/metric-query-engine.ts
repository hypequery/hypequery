/** Metric validation, compilation orchestration and execution. */
import type { MetricRef, GrainedMetricRef, MetricQuery, MetricResult, ExecutionContext } from './types.js';
import type { QueryBuilderFactoryLike, QueryBuilderFactoryInput } from './query-builder-protocol.js';
import { toQueryBuilderFactory } from './query-builder-protocol.js';
import type { ValidationResult } from './validation.js';
import { assertMetricHandle, getMetricRef, getMetricGrain } from './utils/metric-handle.js';
import { validateMetricQueryInput } from './utils/metric-query-validation.js';
import { buildMetricQueryBuilder } from './utils/metric-query-builder.js';
import { buildDerivedMetricSql } from './utils/metric-derived-query.js';
import { applyPagination, overfetchLimit } from './utils/pagination.js';
import { serializeSemanticMeasureValues } from './utils/semantic-result-serialization.js';
import { getRuntimeTenantId } from './utils/tenant-runtime.js';

export interface MetricQueryEngineOptions {
  /** Query builder factory for executing metrics. */
  builderFactory: QueryBuilderFactoryInput;
}

export class MetricQueryEngine {
  private builderFactory: QueryBuilderFactoryLike;

  constructor(options: MetricQueryEngineOptions) {
    this.builderFactory = toQueryBuilderFactory(options.builderFactory);
  }

  protected getBuilderFactory(): QueryBuilderFactoryLike {
    return this.builderFactory;
  }

  /** Resolve a per-call override against this engine's default factory. */
  protected resolveBuilderFactory(context?: ExecutionContext): QueryBuilderFactoryLike {
    const override = context?.runtime?.builderFactory;
    return override ? toQueryBuilderFactory(override) : this.getBuilderFactory();
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
      return buildDerivedMetricSql(ref, spec, query, grain, this.resolveBuilderFactory(context), context).sql;
    }

    const builder = buildMetricQueryBuilder(ref, spec, ref.dataset, query, grain, this.resolveBuilderFactory(context), context);
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

    const queryValidation = validateMetricQueryInput(metric, query, context);
    if (!queryValidation.valid) {
      return queryValidation;
    }

    const ref = getMetricRef(metric);
    const grain = getMetricGrain(metric, query);

    try {
      if (ref.spec.__type === 'derived_metric_spec') {
        buildDerivedMetricSql(ref, ref.spec, query, grain, this.resolveBuilderFactory(context), context);
      } else {
        buildMetricQueryBuilder(ref, ref.spec, ref.dataset, query, grain, this.resolveBuilderFactory(context), context).toSQLWithParams();
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
    const activeBuilderFactory = this.resolveBuilderFactory(context);

    // Over-fetch one row so we can report `hasMore` without a count query.
    const buildQuery = { ...query, limit: overfetchLimit(query.limit) };

    if (spec.__type === 'derived_metric_spec') {
      // Derived metrics: build CTE via builder, outer query via string, execute via rawQuery
      const { sql, params } = buildDerivedMetricSql(ref, spec, buildQuery, grain, activeBuilderFactory, context);
      const rows = await activeBuilderFactory.rawQuery<T>(sql, params, {
        abortSignal: context?.abortSignal,
      });
      const timingMs = Date.now() - start;
      const { data, pagination } = applyPagination(rows, query.limit, query.offset);
      const serializedData = serializeSemanticMeasureValues(data, [ref.name]);
      return {
        data: serializedData,
        meta: {
          sql,
          timingMs,
          tenant: getRuntimeTenantId(context),
          rowCount: serializedData.length,
          pagination,
        },
      };
    }

    // Base metrics: fully use the builder's execute()
    const builder = buildMetricQueryBuilder(ref, spec, ref.dataset, buildQuery, grain, activeBuilderFactory, context);
    const { sql } = builder.toSQLWithParams();
    const rows = await builder.execute<T>({ abortSignal: context?.abortSignal });
    const timingMs = Date.now() - start;
    const { data, pagination } = applyPagination(rows, query.limit, query.offset);
    const serializedData = serializeSemanticMeasureValues(data, [ref.name]);
    return {
      data: serializedData,
      meta: {
        sql,
        timingMs,
        tenant: getRuntimeTenantId(context),
        rowCount: serializedData.length,
        pagination,
      },
    };
  }
}
