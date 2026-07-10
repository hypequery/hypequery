/**
 * Relationship helpers for dataset definitions.
 *
 * These helpers currently define semantic model metadata only. The shipped
 * semantic client does not yet resolve relationship paths into joined dataset queries
 * or cross-dataset metrics.
 *
 * @example
 * ```ts
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   fields: { ... },
 *   relationships: {
 *     customer: belongsTo(() => Customers, { from: "customerId", to: "id" }),
 *   },
 * });
 * ```
 */

import type { RelationshipDefinition, RelationshipKind } from './types.js';

function createRelationship<
  TTarget extends { __type: 'dataset'; name: string },
  TKind extends RelationshipKind,
>(
  kind: TKind,
  target: () => TTarget,
  join: { from: string; to: string },
): RelationshipDefinition<TTarget, TKind> {
  return {
    __type: 'relationship',
    kind,
    target,
    from: join.from,
    to: join.to,
  };
}

/** Many-to-one relationship (FK on this table). */
export function belongsTo<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: { from: string; to: string },
): RelationshipDefinition<TTarget, 'belongsTo'> {
  return createRelationship('belongsTo', target, join);
}

/** One-to-many relationship (FK on target table). */
export function hasMany<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: { from: string; to: string },
): RelationshipDefinition<TTarget, 'hasMany'> {
  return createRelationship('hasMany', target, join);
}

/** One-to-one relationship (FK on target table). */
export function hasOne<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: { from: string; to: string },
): RelationshipDefinition<TTarget, 'hasOne'> {
  return createRelationship('hasOne', target, join);
}
