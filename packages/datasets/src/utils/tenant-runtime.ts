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
