import { notGroupableError } from './groupable.js';
import { resolveRelationshipMeasure } from './relationship-measures.js';
import { semanticQuerySyntaxErrors } from './semantic-query-syntax.js';
import { queryTimezoneErrors } from './query-timezone.js';
import { baseMeasureNames } from './dataset-measures.js';
import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
} from '../types.js';
import { validateFilterValue, type ValidationResult } from '../validation.js';
import { unsupportedTimeGrainError } from './dataset-time-grains.js';
import {
  getRuntimeTenantPredicate,
  validateTenantRuntime,
} from './tenant-runtime.js';
import {
  isQualifiedField,
  resolveQualifiedField,
} from './relationship-fields.js';
import {
  validateQualifiedFilter,
  validateRelationshipTenantRuntime,
} from './relationship-validation.js';
import { segmentSelectionErrors } from './segments.js';
import { filterAllowsOperator } from './filter-operator-policy.js';
import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import { enforcedConstraintErrors } from './enforced-constraints.js';
import { analyzeTimeMeasureAxis } from './time-measure-axis.js';
import { datasetHavingErrors } from './dataset-having.js';
import { datasetOnTimeKey, selectedTimeKeyError } from './dataset-time-keys.js';
import { effectiveFilters } from './effective-filters.js';

export function validateDatasetQueryInput(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): ValidationResult {
  // Validate against the selected time axis, so grain and window checks see it.
  const timeKeyError = selectedTimeKeyError(dataset, query.timeKey);
  const ds = timeKeyError ? dataset : datasetOnTimeKey(dataset, query.timeKey);
  const errors: string[] = [
    ...semanticQuerySyntaxErrors(query),
    ...queryTimezoneErrors(query.timezone),
    ...(timeKeyError ? [timeKeyError] : []),
  ];
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const selectedDimensions = query.dimensions ?? [];
  const selectedMeasures = query.measures ?? baseMeasureNames(ds.measures);
  for (const name of selectedDimensions) {
    if (selectedMeasures.includes(name)) {
      errors.push(`Output "${name}" cannot be selected as both a dimension and a measure. Select one or give the definitions distinct names.`);
    }
  }
  const filters = effectiveFilters(ds);
  const filterNames = Object.keys(filters);
  const orderableFields = new Set<string>([
    ...selectedDimensions,
    ...selectedMeasures,
    ...(query.by ? ['period'] : []),
  ]);

  const tenantRuntimeError = validateTenantRuntime(ds, context);
  if (tenantRuntimeError) {
    errors.push(tenantRuntimeError);
  }
  const relationshipTenantError = validateRelationshipTenantRuntime(ds, query, context);
  if (relationshipTenantError) {
    errors.push(relationshipTenantError);
  }
  errors.push(...enforcedConstraintErrors(ds, context, query.filters?.length ?? 0));

  if (selectedDimensions.length === 0 && selectedMeasures.length === 0) {
    errors.push(`Dataset "${ds.name}" query must select at least one dimension or measure.`);
  }

  if (query.dimensions) {
    for (const dimension of query.dimensions) {
      if (isQualifiedField(dimension)) {
        const resolution = resolveQualifiedField(ds, dimension);
        if (resolution?.error) {
          errors.push(resolution.error);
        } else if (resolution?.resolved?.targetDimension.groupable === false) {
          errors.push(notGroupableError(dimension));
        }
        continue;
      }
      if (!dimensionNames.includes(dimension)) {
        errors.push(`Unknown dimensions: ${dimension}. Available: ${dimensionNames.join(', ')}`);
      } else if (ds.dimensions[dimension]?.groupable === false) {
        errors.push(notGroupableError(dimension));
      }
    }
  }

  if (query.measures) {
    for (const measure of query.measures) {
      if (isQualifiedField(measure)) {
        try { resolveRelationshipMeasure(ds, measure); }
        catch (error) { errors.push((error as Error).message); }
        continue;
      }
      if (!measureNames.includes(measure)) {
        errors.push(`Unknown measures: ${measure}. Available: ${measureNames.join(', ')}`);
      }
    }
  }

  if (query.filters) {
    for (const filter of query.filters) {
      if (isQualifiedField(filter.field)) {
        const filterError = validateQualifiedFilter(ds, filter, context);
        if (filterError) {
          errors.push(filterError);
        }
        continue;
      }

      if (!filterNames.includes(filter.field)) {
        errors.push(`Unknown filter fields: ${filter.field}. Available: ${filterNames.join(', ')}`);
        continue;
      }

      const filterDefinition = filters[filter.field];
      if (!filterAllowsOperator(filterDefinition, filter.operator)) {
        errors.push(
          `Filter "${filter.field}" does not allow operator "${filter.operator}". Allowed: ${(filterDefinition?.operators ?? SEMANTIC_FILTER_OPERATORS).join(', ')}`,
        );
        continue;
      }

      const resolvedField = filterDefinition.field;
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
    const invalid: string[] = [];
    for (const order of query.orderBy) {
      if (isQualifiedField(order.field) && !selectedMeasures.includes(order.field)) {
        const resolution = resolveQualifiedField(ds, order.field);
        if (resolution?.error) {
          errors.push(resolution.error);
          continue;
        }
        // A resolvable qualified field is only orderable when it is also
        // selected as a dimension (same rule as unqualified fields). Otherwise
        // the sort silently no-ops in-memory and breaks the SQL alias, so fall
        // through to the orderableFields check rather than accepting it.
      }
      if (!orderableFields.has(order.field)) {
        invalid.push(order.field);
      }
    }
    if (invalid.length > 0) {
      errors.push(`Unknown orderBy fields: ${invalid.join(', ')}. Available: ${Array.from(orderableFields).join(', ')}`);
    }
  }

  if (query.by && !ds.timeKey) {
    errors.push(`Cannot use "by" grain — dataset "${ds.name}" has no timeKey.`);
  }

  errors.push(...analyzeTimeMeasureAxis(ds, query).errors);

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

  if (ds.limits?.maxDimensions && query.dimensions && query.dimensions.length > ds.limits.maxDimensions) {
    errors.push(`Too many dimensions: ${query.dimensions.length} (max ${ds.limits.maxDimensions})`);
  }

  if (ds.limits?.maxMeasures && query.measures && query.measures.length > ds.limits.maxMeasures) {
    errors.push(`Too many measures: ${query.measures.length} (max ${ds.limits.maxMeasures})`);
  }

  errors.push(...datasetHavingErrors(ds, query, selectedMeasures));

  if (ds.limits?.maxFilters && query.filters && query.filters.length > ds.limits.maxFilters) {
    errors.push(`Too many filters: ${query.filters.length} (max ${ds.limits.maxFilters})`);
  }

  if (ds.limits?.maxResultSize && query.limit != null && query.limit > ds.limits.maxResultSize) {
    errors.push(`Too many results requested: ${query.limit} (max ${ds.limits.maxResultSize})`);
  }

  return { valid: errors.length === 0, errors };
}
