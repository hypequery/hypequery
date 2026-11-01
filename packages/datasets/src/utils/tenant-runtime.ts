import type {
  AnyDatasetInstance,
  ExecutionContext,
} from '../types.js';

export type TenantPredicate =
  | { operator: 'eq'; value: string }
  | { operator: 'in'; value: string[] };

export function getRuntimeTenantPredicate(
  context?: ExecutionContext,
): TenantPredicate | undefined {
  const tenant = context?.runtime?.tenant;
  if (!tenant) {
    return undefined;
  }
  if (typeof tenant === 'string') {
    return { operator: 'eq', value: tenant };
  }
  if ('id' in tenant) {
    return { operator: 'eq', value: tenant.id };
  }
  if ('in' in tenant && tenant.in.length > 0) {
    return { operator: 'in', value: tenant.in };
  }
  return undefined;
}

export function getRuntimeTenantId(context?: ExecutionContext): string | undefined {
  const predicate = getRuntimeTenantPredicate(context);
  return predicate?.operator === 'eq' ? predicate.value : undefined;
}

export function isCrossTenantRuntime(context?: ExecutionContext): boolean {
  const tenant = context?.runtime?.tenant;
  return !!tenant && typeof tenant === 'object' && 'scope' in tenant && tenant.scope === 'all';
}

/**
 * Whether a join from `base` to `target` must also match their tenant keys.
 * One tenant pins both sides to the same id already. A scope over several
 * tenants, or all of them, admits every scoped tenant's target rows, so a key
 * reused across tenants would otherwise match another tenant's row.
 */
export function joinsWithinTenant(
  base: Pick<AnyDatasetInstance, 'tenantKey'>,
  target: Pick<AnyDatasetInstance, 'tenantKey'>,
  context?: ExecutionContext,
): boolean {
  if (!base.tenantKey || !target.tenantKey) {
    return false;
  }
  const predicate = getRuntimeTenantPredicate(context);
  if (predicate) {
    return predicate.operator === 'in' && predicate.value.length > 1;
  }
  return isCrossTenantRuntime(context);
}

export function hasTenantRuntime(context?: ExecutionContext): boolean {
  return !!getRuntimeTenantPredicate(context) || isCrossTenantRuntime(context);
}

export function validateTenantRuntime(
  ds: AnyDatasetInstance,
  context?: ExecutionContext,
): string | undefined {
  if (!ds.tenantKey) {
    return undefined;
  }
  if (!hasTenantRuntime(context)) {
    return `Dataset "${ds.name}" requires runtime tenant scoping.`;
  }
  return undefined;
}
