import type { AnyDatasetInstance, ExecutionContext, MetricFilter } from '../types.js';
import { validateFilterValue } from '../validation.js';
import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import { isQualifiedField } from './relationship-fields.js';
import { validateQualifiedFilter } from './relationship-validation.js';
import { filterAllowsOperator } from './filter-operator-policy.js';
import { effectiveFilters } from './effective-filters.js';

/**
 * Why each `{ field, operator, value }` filter cannot apply to `ds`: an
 * unknown or disallowed field or operator, a value of the wrong type, or the
 * tenant field under runtime tenancy. Query `filters` and RFC 0026 filter
 * calculations share these rules.
 */
export function queryFilterErrors(
  ds: AnyDatasetInstance,
  queryFilters: readonly MetricFilter[],
  context?: ExecutionContext,
): string[] {
  const errors: string[] = [];
  const filters = effectiveFilters(ds);
  const filterNames = Object.keys(filters);
  for (const filter of queryFilters) {
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

  return errors;
}
