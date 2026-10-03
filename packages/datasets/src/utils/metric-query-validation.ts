/** Semantic metric validation; independent of SQL compilation and execution. */
import type { MetricQuery, ExecutionContext } from '../types.js';
import { validateFilterValue, type ValidationResult } from '../validation.js';
import { queryTimezoneErrors } from './query-timezone.js';
import { protocolMetricCapabilityErrors } from './protocol-metric-capabilities.js';
import { unsupportedTimeGrainError } from './dataset-time-grains.js';
import { getMetricGrain, getMetricRef, isTenantScopedFilter, type MetricHandle } from './metric-handle.js';
import { validateTenantRuntime } from './tenant-runtime.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';
import { validateQualifiedFilter, validateRelationshipTenantRuntime } from './relationship-validation.js';
import { segmentSelectionErrors } from './segments.js';

export function validateMetricQueryInput(
  metric: MetricHandle,
  query: MetricQuery,
  context?: ExecutionContext,
): ValidationResult {
  const errors = [...protocolMetricCapabilityErrors(metric, query), ...queryTimezoneErrors(query.timezone)];
  const ref = getMetricRef(metric);
  const ds = ref.dataset;
  const dimensionNames = Object.keys(ds.dimensions);
  const filterNames = Object.keys(ds.filters);
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
  const relationshipTenantError = validateRelationshipTenantRuntime(ds, query, context);
  if (relationshipTenantError) {
    errors.push(relationshipTenantError);
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
  errors.push(...segmentSelectionErrors(ds, query.segments));

  const grainError = query.by && ds.timeKey ? unsupportedTimeGrainError(ds, query.by) : undefined;
  if (grainError) {
    errors.push(grainError);
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
