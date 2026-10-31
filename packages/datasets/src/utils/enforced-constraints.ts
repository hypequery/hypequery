import { isSemanticFilterOperator } from '../constants.js';
import type { AnyDatasetInstance, ExecutionContext, MetricFilter } from '../types.js';
import { validateFilterValue } from '../validation.js';
import { filterAllowsOperator } from './filter-operator-policy.js';
import { effectiveFilters } from './effective-filters.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';
import { validateQualifiedFilter } from './relationship-validation.js';

/** Constraints are policy, not queries; a handful per call is plenty (RFC 0019). */
export const MAX_ENFORCED_CONSTRAINTS = 32;

function constraintError(ds: AnyDatasetInstance, constraint: unknown, context?: ExecutionContext): boolean {
  if (typeof constraint !== 'object' || constraint === null) return true;
  const filter = constraint as MetricFilter;
  if (typeof filter.field !== 'string' || !isSemanticFilterOperator(filter.operator)) return true;
  if (isQualifiedField(filter.field)) {
    if (!resolveQualifiedField(ds, filter.field)?.resolved) return true;
    return validateQualifiedFilter(ds, filter, context) !== null;
  }
  const filters = effectiveFilters(ds);
  if (!Object.hasOwn(filters, filter.field)) return true;
  const definition = filters[filter.field];
  if (!filterAllowsOperator(definition, filter.operator)) return true;
  const fieldType = ds.dimensions[definition.field]?.fieldType;
  return !!fieldType && validateFilterValue(filter, fieldType) !== null;
}

/**
 * Errors for the call's RFC 0019 enforced constraints on `ds`. A constraint
 * the dataset cannot enforce refuses the call, with a message that does not
 * describe the constraint: it is the provider's policy, not the caller's
 * input. `callerFilters` is the number of filters the caller supplied, which
 * share the dataset's filter ceiling with the constraints.
 */
export function enforcedConstraintErrors(
  ds: AnyDatasetInstance,
  context: ExecutionContext | undefined,
  callerFilters: number,
): string[] {
  const constraints: unknown = context?.runtime?.constraints;
  if (constraints === undefined) return [];
  const unenforceable = [`Dataset "${ds.name}" cannot enforce a runtime constraint.`];
  if (!Array.isArray(constraints) || constraints.length > MAX_ENFORCED_CONSTRAINTS) return unenforceable;
  if (constraints.length === 0) return [];
  const maxFilters = ds.limits?.maxFilters;
  if (maxFilters && constraints.length > maxFilters) return unenforceable;
  if (constraints.some(constraint => constraintError(ds, constraint, context))) return unenforceable;
  if (maxFilters && callerFilters > maxFilters - constraints.length) {
    return [`Too many filters: ${callerFilters} (max ${maxFilters - constraints.length} under the enforced constraints)`];
  }
  return [];
}

/** Throws when the call's constraints cannot all be enforced on `ds`. */
export function assertEnforcedConstraints(ds: AnyDatasetInstance, context?: ExecutionContext): void {
  const [error] = enforcedConstraintErrors(ds, context, 0);
  if (error) throw new Error(error);
}
