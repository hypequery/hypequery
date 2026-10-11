/**
 * Relationship helpers for dataset definitions.
 *
 * To-one relationships (`belongsTo`, `hasOne`) are queryable one hop deep as
 * `<relationship>.<dimension>` and execute as LEFT JOINs. `hasMany` is metadata
 * only: joining it would fan out and corrupt aggregates, so it is refused at
 * query time.
 *
 * Target dimensions and safe base measures are reachable one hop deep.
 * Use `keys` for multiple physical column equalities joined with AND.
 *
 * Note that the `kind` passed here is a declaration, not something checked at
 * query time. Joins are single-match (`leftAnyJoin`, ClickHouse
 * `LEFT ANY JOIN`), so a mis-declared to-one relationship cannot inflate an
 * aggregate, but it does make the join pick an arbitrary one of the matching
 * target rows. Builders without `leftAnyJoin` are refused rather than
 * downgraded to a fan-out `leftJoin`. The in-memory backend refuses duplicate
 * target keys outright, and `checkRelationships()` reports them against a live
 * database, so a wrong declaration can be caught before it skews results.
 *
 * @example
 * ```ts
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   dimensions: {
 *     id: dimension.string(),
 *     customerId: dimension.string({ column: "customer_id" }),
 *   },
 *   relationships: {
 *     // Join keys are source columns, not dimension names.
 *     customer: belongsTo(() => Customers, { from: "customer_id", to: "id" }),
 *   },
 * });
 *
 * // Groups by a dimension on Customers, joining through the relationship.
 * await client.execute(Orders, { dimensions: ["customer.country"] });
 * ```
 */

import type { RelationshipDefinition, RelationshipJoin } from './types.js';
import { createRelationship } from './utils/relationship-definition.js';

/** Many-to-one relationship (FK on this table). */
export function belongsTo<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: RelationshipJoin,
): RelationshipDefinition<TTarget, 'belongsTo'> {
  return createRelationship('belongsTo', target, join);
}

/** One-to-many relationship (FK on target table). */
export function hasMany<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: RelationshipJoin,
): RelationshipDefinition<TTarget, 'hasMany'> {
  return createRelationship('hasMany', target, join);
}

/** One-to-one relationship (FK on target table). */
export function hasOne<TTarget extends { __type: 'dataset'; name: string }>(
  target: () => TTarget,
  join: RelationshipJoin,
): RelationshipDefinition<TTarget, 'hasOne'> {
  return createRelationship('hasOne', target, join);
}
