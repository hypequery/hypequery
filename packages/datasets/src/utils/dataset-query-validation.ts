import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
} from '../types.js';
import { validateFilterValue, type ValidationResult } from '../validation.js';
import { SUPPORTED_TIME_GRAINS, isSupportedTimeGrain } from '../constants.js';
import {
  getRuntimeTenantPredicate,
  validateTenantRuntime,
} from './tenant-runtime.js';

export function validateDatasetQueryInput(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): ValidationResult {
  const errors: string[] = [];
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const selectedDimensions = query.dimensions ?? [];
  const selectedMeasures = query.measures ?? measureNames;
  const filterNames = Object.keys(ds.filters);
  const orderableFields = new Set<string>([
    ...selectedDimensions,
    ...selectedMeasures,
    ...(query.by ? ['period'] : []),
  ]);

  const tenantRuntimeError = validateTenantRuntime(ds, context);
  if (tenantRuntimeError) {
    errors.push(tenantRuntimeError);
  }

  if (selectedDimensions.length === 0 && selectedMeasures.length === 0) {
    errors.push(`Dataset "${ds.name}" query must select at least one dimension or measure.`);
  }

  if (query.dimensions) {
    const invalid = query.dimensions.filter(dimension => !dimensionNames.includes(dimension));
    if (invalid.length > 0) {
      errors.push(`Unknown dimensions: ${invalid.join(', ')}. Available: ${dimensionNames.join(', ')}`);
    }
  }

  if (query.measures) {
    const invalid = query.measures.filter(measure => !measureNames.includes(measure));
    if (invalid.length > 0) {
      errors.push(`Unknown measures: ${invalid.join(', ')}. Available: ${measureNames.join(', ')}`);
    }
  }

  if (query.filters) {
    const invalid = query.filters.filter(filter => !filterNames.includes(filter.field));
    if (invalid.length > 0) {
      errors.push(`Unknown filter fields: ${invalid.map(filter => filter.field).join(', ')}. Available: ${filterNames.join(', ')}`);
    }

    for (const filter of query.filters) {
      const filterDefinition = ds.filters[filter.field];
      if (filterDefinition?.operators && !filterDefinition.operators.includes(filter.operator)) {
        errors.push(
          `Filter "${filter.field}" does not allow operator "${filter.operator}". Allowed: ${filterDefinition.operators.join(', ')}`,
        );
        continue;
      }

      const resolvedField = ds.filters[filter.field]?.field ?? filter.field;
      const resolvedDimension = ds.dimensions[resolvedField];
      const resolvedColumn = resolvedDimension?.sql
        ? undefined
        : resolvedDimension?.column ?? resolvedField;
      if (getRuntimeTenantPredicate(context) && ds.tenantKey && resolvedColumn === ds.tenantKey) {
        errors.push(
          `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
        );
        continue;
      }

      const fieldType = resolvedDimension?.fieldType;
      if (!fieldType) {
        continue;
      }

      const filterError = validateFilterValue(filter, fieldType);
      if (filterError) {
        errors.push(filterError);
      }
    }
  }

  if (query.orderBy) {
    const invalid = query.orderBy.filter(order => !orderableFields.has(order.field));
    if (invalid.length > 0) {
      errors.push(`Unknown orderBy fields: ${invalid.map(order => order.field).join(', ')}. Available: ${Array.from(orderableFields).join(', ')}`);
    }
  }

  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  if (query.by && !isSupportedTimeGrain(query.by)) {
    errors.push(`Unsupported time grain "${query.by}". Supported: ${SUPPORTED_TIME_GRAINS.join(', ')}`);
  }

  if (query.limit != null && (!Number.isInteger(query.limit) || query.limit < 0)) {
    errors.push(`Invalid limit: expected a non-negative integer.`);
  }

  if (query.offset != null && (!Number.isInteger(query.offset) || query.offset < 0)) {
    errors.push(`Invalid offset: expected a non-negative integer.`);
  }

  if (ds.limits?.maxDimensions && query.dimensions && query.dimensions.length > ds.limits.maxDimensions) {
    errors.push(`Too many dimensions: ${query.dimensions.length} (max ${ds.limits.maxDimensions})`);
  }

  if (ds.limits?.maxMeasures && query.measures && query.measures.length > ds.limits.maxMeasures) {
    errors.push(`Too many measures: ${query.measures.length} (max ${ds.limits.maxMeasures})`);
  }

  if (ds.limits?.maxFilters && query.filters && query.filters.length > ds.limits.maxFilters) {
    errors.push(`Too many filters: ${query.filters.length} (max ${ds.limits.maxFilters})`);
  }

  if (ds.limits?.maxResultSize && query.limit != null && query.limit > ds.limits.maxResultSize) {
    errors.push(`Too many results requested: ${query.limit} (max ${ds.limits.maxResultSize})`);
  }

  return { valid: errors.length === 0, errors };
}
