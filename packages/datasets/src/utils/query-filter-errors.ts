import type { AnyDatasetInstance, DatasetFilterNode, ExecutionContext } from '../types.js';
import { validateFilterValue } from '../validation.js';
import { SEMANTIC_FILTER_OPERATORS } from '../constants.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import { isQualifiedField } from './relationship-fields.js';
import { validateQualifiedFilter } from './relationship-validation.js';
import { filterAllowsOperator } from './filter-operator-policy.js';
import { effectiveFilters } from './effective-filters.js';
import { effectiveFilterLeaves } from './filter-tree.js';
import { relativeDateFilterError } from './relative-date-filters.js';

/**
 * Why each comparison of a filter tree cannot apply to `ds`: an unknown or
 * disallowed field or operator (under `not`, the negated operator the
 * allowlist must permit), a value of the wrong type, an unresolved relative
 * range, or the tenant field under runtime tenancy. Query `filters` and RFC
 * 0026 filter calculations share these rules; a malformed tree is reported by
 * `filterTreeErrors`, not here.
 */
export function queryFilterErrors(
  ds: AnyDatasetInstance,
  queryFilters: readonly DatasetFilterNode[],
  context?: ExecutionContext,
): string[] {
  const errors: string[] = [];
  const filters = effectiveFilters(ds);
  const filterNames = Object.keys(filters);
  for (const { filter, operators } of effectiveFilterLeaves(queryFilters)) {
    // The client resolves every valid relative range first (RFC 0029); one
    // still here could not be resolved, and says why.
    if (filter.operator === 'inDateRange') {
      errors.push(relativeDateFilterError(ds, filter) ?? `Filter "${filter.field}": "inDateRange" was not resolved before validation.`);
      continue;
    }
    if (isQualifiedField(filter.field)) {
      const filterError = validateQualifiedFilter(ds, filter, context, operators);
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
    const refused = operators.find(operator => !filterAllowsOperator(filterDefinition, operator));
    if (refused) {
      errors.push(
        `Filter "${filter.field}" does not allow operator "${refused}"${refused === filter.operator ? '' : ` (the negation of "${filter.operator}")`}. Allowed: ${(filterDefinition?.operators ?? SEMANTIC_FILTER_OPERATORS).join(', ')}`,
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
