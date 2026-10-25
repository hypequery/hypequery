import type {
  AnyDatasetInstance,
  ExecutionContext,
  MetricFilter,
} from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { getRuntimeTenantPredicate, type TenantPredicate } from './tenant-runtime.js';

/** A trusted predicate on one of a dataset's own physical columns. */
export type RowScopePredicate = TenantPredicate & { readonly column: string };

/**
 * The trusted predicates restricting which source rows of `ds` any query may
 * read (RFC 0020). They apply to the queried dataset and to every joined
 * relationship target alike. `tenantKey` with a runtime tenant lowers to one
 * predicate; the trusted cross-tenant scope (`scope: 'all'`) lowers to none.
 */
export function datasetRowScope(
  ds: Pick<AnyDatasetInstance, 'tenantKey'>,
  context?: ExecutionContext,
): RowScopePredicate[] {
  const tenant = getRuntimeTenantPredicate(context);
  return tenant && ds.tenantKey ? [{ column: ds.tenantKey, ...tenant }] : [];
}

/**
 * The call's RFC 0019 enforced constraints, from trusted context only. They
 * apply to the queried dataset, in its filter vocabulary, never to joined
 * targets.
 */
export function runtimeConstraints(context?: ExecutionContext): readonly MetricFilter[] {
  return context?.runtime?.constraints ?? [];
}

/** ANDs each row-scope predicate onto `qb`, with columns qualified by `qualify`. */
export function applyRowScope(
  qb: QueryBuilderLike,
  scope: readonly RowScopePredicate[],
  qualify: (column: string) => string = column => column,
): QueryBuilderLike {
  for (const predicate of scope) {
    qb = qb.where(qualify(predicate.column), predicate.operator, predicate.value);
  }
  return qb;
}
