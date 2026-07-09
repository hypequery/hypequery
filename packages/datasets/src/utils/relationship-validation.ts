/**
 * Shared validation for relationship-qualified filters, used by both the
 * dataset-query and metric-query validators.
 */

import type {
  AnyDatasetInstance,
  ExecutionContext,
  MetricFilter,
} from '../types.js';
import { validateFilterValue } from '../validation.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import { resolveQualifiedField } from './relationship-fields.js';

/**
 * Validates a relationship-qualified filter (`relationship.field`). Returns an
 * error message string, or null when the filter is valid.
 *
 * Enforces the same tenant rule the base dataset uses: when runtime tenancy is
 * active and the joined target declares a `tenantKey`, an explicit filter on
 * that column is rejected (the planner injects the tenant predicate instead).
 */
export function validateQualifiedFilter(
  ds: AnyDatasetInstance,
  filter: MetricFilter,
  context?: ExecutionContext,
): string | null {
  const resolution = resolveQualifiedField(ds, filter.field);
  if (!resolution) {
    return null;
  }
  if (!resolution.resolved) {
    return resolution.error;
  }

  const { target, targetColumn, targetDimension } = resolution.resolved;

  if (getRuntimeTenantPredicate(context) && target.tenantKey && targetColumn === target.tenantKey) {
    return `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`;
  }

  return validateFilterValue(filter, targetDimension.fieldType);
}
