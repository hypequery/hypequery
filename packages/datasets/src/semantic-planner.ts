import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricFilter,
  MetricOrderBy,
  MetricQuery,
  MetricRef,
  GrainedMetricRef,
} from './types.js';
import type {
  PlanNode,
  SemanticAggregationPlan,
  SemanticDimensionPlan,
  SemanticJoinPlan,
} from './semantic-plan.js';
import {
  getMetricGrain,
  getMetricRef,
  type MetricHandle,
} from './utils/metric-handle.js';
import { validateDatasetQuery } from './dataset-query.js';
import { isSupportedTimeGrain } from './constants.js';
import { getRuntimeTenantPredicate } from './utils/tenant-runtime.js';
import { isQualifiedField, resolveQualifiedField } from './utils/relationship-fields.js';

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

/**
 * Resolves a relationship-qualified field to its plan field name
 * (`<relationship>.<targetColumn>`). Validation runs before planning, so an
 * unresolved qualified name here is a programming error.
 */
function resolveQualifiedPlanField(ds: AnyDatasetInstance, name: string) {
  const resolution = resolveQualifiedField(ds, name);
  if (!resolution || !resolution.resolved) {
    throw new Error(resolution?.error ?? `Cannot resolve relationship field "${name}".`);
  }
  return resolution.resolved;
}

function dimensionsForQuery(
  ds: AnyDatasetInstance,
  dimensions: string[] = [],
): SemanticDimensionPlan[] {
  return dimensions.map((name) => {
    if (isQualifiedField(name)) {
      const { relationshipName, targetColumn, targetDimension } = resolveQualifiedPlanField(ds, name);
      return {
        name,
        field: `${relationshipName}.${targetColumn}`,
        fieldType: targetDimension.fieldType,
      };
    }
    return {
      name,
      field: resolveField(ds, name),
      fieldType: ds.dimensions[name]?.fieldType,
    };
  });
}

function normalizeFilters(
  ds: AnyDatasetInstance,
  filters: MetricFilter[] = [],
): MetricFilter[] {
  return filters.map((filter) => {
    if (isQualifiedField(filter.field)) {
      const { relationshipName, targetColumn } = resolveQualifiedPlanField(ds, filter.field);
      return { ...filter, field: `${relationshipName}.${targetColumn}` };
    }
    const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
    return {
      ...filter,
      field: resolveField(ds, resolvedField),
    };
  });
}

/**
 * Collects deduped to-one LEFT JOINs for every relationship referenced by the
 * query's dimensions, filters, or orderBy, scoping each joined target with the
 * runtime tenant predicate when the target declares a `tenantKey`.
 */
function collectJoins(
  ds: AnyDatasetInstance,
  dimensions: string[] = [],
  filters: MetricFilter[] = [],
  orderBy: MetricOrderBy[] = [],
  context?: ExecutionContext,
): SemanticJoinPlan[] | undefined {
  const referenced = [
    ...dimensions,
    ...filters.map((filter) => filter.field),
    ...orderBy.map((order) => order.field),
  ].filter(isQualifiedField);
  if (referenced.length === 0) {
    return undefined;
  }

  const tenantPredicate = getRuntimeTenantPredicate(context);
  const joins = new Map<string, SemanticJoinPlan>();
  for (const name of referenced) {
    const { relationshipName, relationship, target } = resolveQualifiedPlanField(ds, name);
    if (joins.has(relationshipName)) {
      continue;
    }
    joins.set(relationshipName, {
      relationship: relationshipName,
      source: target.source,
      from: relationship.from,
      to: relationship.to,
      type: 'left',
      tenant: tenantPredicate && target.tenantKey
        ? { field: target.tenantKey, ...tenantPredicate }
        : undefined,
    });
  }
  return Array.from(joins.values());
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
    argField: measure.argField != null ? resolveField(ds, measure.argField) : undefined,
    level: measure.level,
    filters: normalizeFilters(ds, measure.filters),
  };
}

function tenantForContext(ds: AnyDatasetInstance, context?: ExecutionContext) {
  const tenantPredicate = getRuntimeTenantPredicate(context);
  if (!tenantPredicate || !ds.tenantKey) {
    return undefined;
  }
  return { field: ds.tenantKey, ...tenantPredicate };
}

function grainForQuery(ds: AnyDatasetInstance, unit: MetricQuery['by'] | undefined) {
  if (!unit) {
    return undefined;
  }
  if (!ds.timeKey) {
    throw new Error(`Cannot use grain "${unit}" because dataset "${ds.name}" has no timeKey.`);
  }
  if (!isSupportedTimeGrain(unit)) {
    throw new Error(`Unsupported time grain "${unit}".`);
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
    joins: collectJoins(ds, query.dimensions, query.filters, query.orderBy, context),
  };
}

export function buildDatasetPlan(
  ds: AnyDatasetInstance,
  query: DatasetQuery = {},
  context?: ExecutionContext,
): PlanNode {
  const validation = validateDatasetQuery(ds, query, context);
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
  if (spec.sql) {
    throw new Error(
      `Semantic backend plans do not support SQL-backed metric "${metric.name}". ` +
      'Use a backend-specific query builder for raw SQL expressions.',
    );
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
      argField: spec.argField != null ? resolveField(metric.dataset, spec.argField) : undefined,
      level: spec.level,
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
    if (baseSpec.sql) {
      throw new Error(
        `Semantic backend plans do not support SQL-backed metric "${alias}" used by derived metric "${metric.name}". ` +
        'Use a backend-specific query builder for raw SQL expressions.',
      );
    }
    return {
      name: alias,
      aggregation: baseSpec.aggregation,
      field: resolveField(metric.dataset, baseSpec.field),
      argField: baseSpec.argField != null ? resolveField(metric.dataset, baseSpec.argField) : undefined,
      level: baseSpec.level,
      filters: baseSpec.filters,
    };
  });

  const inputs = Object.fromEntries(Object.keys(spec.uses).map((alias) => [alias, alias]));
  const expression = spec.formula(inputs).expression;

  return {
    kind: 'derive',
    input: aggregatePlan(
      metric.dataset,
      {
        ...query,
        orderBy: undefined,
        limit: undefined,
        offset: undefined,
      },
      inputAggregations,
      context,
    ),
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
