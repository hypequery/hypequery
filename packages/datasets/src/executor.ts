import type {
  AnyDatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
  ExecutionContext,
  GrainedMetricRef,
  MetricFilter,
  MetricQuery,
  MetricRef,
  MetricResult,
} from './types.js';
import type {
  PlanNode,
  SemanticBackend,
} from './semantic-plan.js';

import { validateFilterValue, type ValidationResult } from './validation.js';
import {
  assertMetricHandle,
  getMetricGrain,
  getMetricRef,
  isTenantScopedFilter,
  type MetricHandle,
} from './utils/metric-handle.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';
import {
  buildDatasetPlan,
  buildMetricPlan,
} from './semantic-planner.js';

function validateMetricQuery(
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

  if (metric.__type === 'grained_metric_ref' && query.by && query.by !== metric.grain) {
    errors.push(
      `Metric "${ref.name}" is already grained by "${metric.grain}" and cannot be queried with by="${query.by}".`,
    );
  }

  for (const dim of query.dimensions ?? []) {
    if (!dimensionNames.includes(dim)) {
      errors.push(`Unknown dimension "${dim}". Available: ${dimensionNames.join(', ')}`);
    }
  }

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
    if (isTenantScopedFilter(ds, filter as MetricFilter, context)) {
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

  for (const order of query.orderBy ?? []) {
    if (!orderableFields.has(order.field)) {
      errors.push(
        `Unknown orderBy field "${order.field}". Available: ${Array.from(orderableFields).join(', ')}`,
      );
    }
  }

  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

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

export interface SemanticExecutorOptions {
  /** Semantic backend for executing neutral semantic plans. */
  backend: SemanticBackend;
}

export class SemanticExecutor {
  private readonly backend: SemanticBackend;

  constructor(options: SemanticExecutorOptions) {
    this.backend = options.backend;
  }

  planMetric(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): PlanNode {
    assertMetricHandle(metric);
    const validation = this.validate(metric, query, context);
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

  async metric<T = Record<string, unknown>>(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery = {},
    context?: ExecutionContext,
  ): Promise<MetricResult<T>> {
    return this.backend.execute<T>(this.planMetric(metric, query, context)) as Promise<MetricResult<T>>;
  }

  async dataset<T = Record<string, unknown>>(
    ds: AnyDatasetInstance,
    query: DatasetQuery = {},
    context?: ExecutionContext,
  ): Promise<DatasetQueryResult<T>> {
    return this.backend.execute<T>(this.planDataset(ds, query, context)) as Promise<DatasetQueryResult<T>>;
  }

  validate(
    metric: MetricRef | GrainedMetricRef,
    query: MetricQuery,
    context?: ExecutionContext,
  ): ValidationResult {
    assertMetricHandle(metric);
    const queryValidation = validateMetricQuery(metric, query, context);
    if (!queryValidation.valid) {
      return queryValidation;
    }

    try {
      buildMetricPlan(metric, query, context);
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    return queryValidation;
  }

  validateDataset(
    ds: AnyDatasetInstance,
    query: DatasetQuery = {},
    context?: ExecutionContext,
  ): ValidationResult {
    return validateDatasetQueryInput(ds, query, context);
  }
}

export function createExecutor(options: SemanticExecutorOptions): SemanticExecutor {
  return new SemanticExecutor(options);
}
