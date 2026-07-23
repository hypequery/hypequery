/**
 * Shared validation for relationship-qualified filters, used by both the
 * dataset-query and metric-query validators.
 */

import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricFilter,
  MetricQuery,
} from '../types.js';
import { validateFilterValue } from '../validation.js';
import {
  getRuntimeTenantPredicate,
  hasTenantRuntime,
} from './tenant-runtime.js';
import {
  isQualifiedField,
  resolveQualifiedField,
} from './relationship-fields.js';

type RelationshipQuery = Pick<
  DatasetQuery & MetricQuery,
  'dimensions' | 'filters' | 'orderBy'
>;

/**
 * Tenant-less base datasets may still reach tenant-scoped data through a
 * relationship. Require either a concrete runtime tenant or the trusted
 * cross-tenant scope whenever a query activates such a join.
 */
export function validateRelationshipTenantRuntime(
  ds: AnyDatasetInstance,
  query: RelationshipQuery,
  context?: ExecutionContext,
): string | undefined {
  if (ds.tenantKey || hasTenantRuntime(context)) {
    return undefined;
  }

  const referenced = [
    ...(query.dimensions ?? []),
    ...(query.filters ?? []).map((filter) => filter.field),
    ...(query.orderBy ?? []).map((order) => order.field),
  ].filter(isQualifiedField);

  for (const name of referenced) {
    const resolution = resolveQualifiedField(ds, name);
    if (resolution?.resolved?.target.tenantKey) {
      return `Dataset "${ds.name}" requires runtime tenant scoping because relationship "${resolution.resolved.relationshipName}" targets a tenant-scoped dataset.`;
    }
  }

  return undefined;
}

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
