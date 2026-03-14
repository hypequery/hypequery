/**
 * Relationship helpers for dataset definitions.
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

import type { DatasetInstance, RelationshipDefinition, RelationshipKind } from './types.js';

function createRelationship(
  kind: RelationshipKind,
  target: () => DatasetInstance<any>,
  join: { from: string; to: string },
): RelationshipDefinition {
  return {
    __type: 'relationship',
    kind,
    target,
    from: join.from,
    to: join.to,
  };
}

/** Many-to-one relationship (FK on this table). */
export function belongsTo(
  target: () => DatasetInstance<any>,
  join: { from: string; to: string },
): RelationshipDefinition {
  return createRelationship('belongsTo', target, join);
}

/** One-to-many relationship (FK on target table). */
export function hasMany(
  target: () => DatasetInstance<any>,
  join: { from: string; to: string },
): RelationshipDefinition {
  return createRelationship('hasMany', target, join);
}

/** One-to-one relationship (FK on target table). */
export function hasOne(
  target: () => DatasetInstance<any>,
  join: { from: string; to: string },
): RelationshipDefinition {
  return createRelationship('hasOne', target, join);
}
