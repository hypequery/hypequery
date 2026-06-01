import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricFilter,
  MetricQuery,
  MetricRef,
  GrainedMetricRef,
} from './types.js';
import type {
  PlanNode,
  SemanticAggregationPlan,
  SemanticDimensionPlan,
} from './semantic-plan.js';
import {
  getMetricGrain,
  getMetricRef,
  type MetricHandle,
} from './utils/metric-handle.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';

function resolveField(ds: AnyDatasetInstance, field: string): string {
  const dimension = ds.dimensions[field];
  if (dimension?.sql) {
    throw new Error(
      `Semantic backend plans do not support SQL-backed dimension "${field}". ` +
      'Use a backend-specific query builder for raw SQL expressions.',
    );
  }
  return dimension?.column ?? field;
}

function dimensionsForQuery(
  ds: AnyDatasetInstance,
  dimensions: string[] = [],
): SemanticDimensionPlan[] {
  return dimensions.map((name) => ({
    name,
    field: resolveField(ds, name),
    fieldType: ds.dimensions[name]?.fieldType,
  }));
}

function normalizeFilters(
  ds: AnyDatasetInstance,
  filters: MetricFilter[] = [],
): MetricFilter[] {
  return filters.map((filter) => {
    const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
    return {
      ...filter,
      field: resolveField(ds, resolvedField),
    };
  });
}

function aggregationForMeasure(
  ds: AnyDatasetInstance,
  name: string,
): SemanticAggregationPlan {
  const measure = ds.measures[name];
  if (!measure) {
    throw new Error(`Unknown measure "${name}" on dataset "${ds.name}".`);
  }
  if (measure.sql) {
    throw new Error(
      `Semantic backend plans do not support SQL-backed measure "${name}". ` +
      'Use a backend-specific query builder for raw SQL expressions.',
    );
  }
  return {
    name,
    aggregation: measure.aggregation,
    field: resolveField(ds, measure.field),
    filters: normalizeFilters(ds, measure.filters),
  };
}

function tenantForContext(ds: AnyDatasetInstance, context?: ExecutionContext) {
  const tenantId = context?.runtime?.tenant?.id;
  const tenantColumn = context?.runtime?.tenant?.column ?? ds.tenantKey;
  if (!tenantId || !tenantColumn) {
    return undefined;
  }
  return { field: tenantColumn, value: tenantId };
}

function grainForQuery(ds: AnyDatasetInstance, unit: MetricQuery['by'] | undefined) {
  if (!unit) {
    return undefined;
  }
  if (!ds.timeKey) {
    throw new Error(`Cannot use grain "${unit}" because dataset "${ds.name}" has no timeKey.`);
  }
  return {
    field: ds.timeKey,
    unit,
    output: 'period' as const,
  };
}

function aggregatePlan(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  aggregations: SemanticAggregationPlan[],
  context?: ExecutionContext,
): PlanNode {
  return {
    kind: 'aggregate',
    source: ds.source,
    dimensions: dimensionsForQuery(ds, query.dimensions),
    aggregations,
    filters: normalizeFilters(ds, query.filters),
    grain: grainForQuery(ds, query.by),
    orderBy: query.orderBy,
    limit: query.limit,
    offset: query.offset,
    tenant: tenantForContext(ds, context),
  };
}

export function buildDatasetPlan(
  ds: AnyDatasetInstance,
  query: DatasetQuery = {},
  context?: ExecutionContext,
): PlanNode {
  const validation = validateDatasetQueryInput(ds, query, context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  const measures = query.measures ?? Object.keys(ds.measures);
  return aggregatePlan(
    ds,
    query,
    measures.map((name) => aggregationForMeasure(ds, name)),
    context,
  );
}

function buildBaseMetricPlan(
  metric: MetricRef,
  query: MetricQuery,
  context?: ExecutionContext,
): PlanNode {
  const spec = metric.spec;
  if (spec.__type !== 'aggregation_spec') {
    throw new Error(`Metric "${metric.name}" is not a base metric.`);
  }

  return aggregatePlan(
    metric.dataset,
    {
      ...query,
      by: query.by,
      measures: [],
    },
    [{
      name: metric.name,
      aggregation: spec.aggregation,
      field: resolveField(metric.dataset, spec.field),
      filters: normalizeFilters(metric.dataset, spec.filters),
    }],
    context,
  );
}

function buildDerivedMetricPlan(
  metric: MetricRef,
  query: MetricQuery,
  context?: ExecutionContext,
): PlanNode {
  const spec = metric.spec;
  if (spec.__type !== 'derived_metric_spec') {
    throw new Error(`Metric "${metric.name}" is not a derived metric.`);
  }

  const inputAggregations = Object.entries(spec.uses).map(([alias, baseMetric]) => {
    const baseSpec = baseMetric.spec;
    if (baseSpec.__type !== 'aggregation_spec') {
      throw new Error(`Derived metric "${metric.name}" references non-base metric "${alias}".`);
    }
    return {
      name: alias,
      aggregation: baseSpec.aggregation,
      field: resolveField(metric.dataset, baseSpec.field),
      filters: baseSpec.filters,
    };
  });

  const inputs = Object.fromEntries(Object.keys(spec.uses).map((alias) => [alias, alias]));
  const expression = spec.formula(inputs).expression;

  return {
    kind: 'derive',
    input: aggregatePlan(metric.dataset, query, inputAggregations, context),
    metrics: [{ name: metric.name, expression }],
    orderBy: query.orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

export function buildMetricPlan(
  metric: MetricRef | GrainedMetricRef,
  query: MetricQuery = {},
  context?: ExecutionContext,
): PlanNode {
  const ref = getMetricRef(metric as MetricHandle);
  const grain = getMetricGrain(metric as MetricHandle, query);
  const plannedQuery = { ...query, by: grain };

  if (ref.spec.__type === 'derived_metric_spec') {
    return buildDerivedMetricPlan(ref, plannedQuery, context);
  }

  return buildBaseMetricPlan(ref, plannedQuery, context);
}
