import type { RelationshipDefinition, RelationshipJoin, RelationshipKey } from '../types.js';

const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate and snapshot authored keys before they are interpolated into SQL. */
export function normalizeRelationshipJoin(join: RelationshipJoin): Pick<RelationshipDefinition, 'from' | 'to' | 'keys'> {
  const composite = join.keys !== undefined;
  if (composite && (join.from !== undefined || join.to !== undefined)) {
    throw new Error('Relationship keys cannot be combined with from/to.');
  }
  const keys = composite ? join.keys : [{ from: join.from, to: join.to }];
  validateRelationshipKeys(keys);
  const copy = keys.map(key => Object.freeze({ from: key.from, to: key.to })) as [RelationshipKey, ...RelationshipKey[]];
  return { from: copy[0].from, to: copy[0].to, ...(composite ? { keys: Object.freeze(copy) } : {}) };
}

export function validateRelationshipKeys(keys: readonly RelationshipKey[]): void {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('Relationship keys must be a non-empty array.');
  const from = new Set<string>();
  const to = new Set<string>();
  for (const key of keys) {
    if (!key || typeof key.from !== 'string' || typeof key.to !== 'string' || !COLUMN.test(key.from) || !COLUMN.test(key.to)) {
      throw new Error('Relationship keys must contain safe physical from/to column identifiers.');
    }
    if (from.has(key.from) || to.has(key.to)) throw new Error('Relationship keys must not repeat a source or target column.');
    from.add(key.from); to.add(key.to);
  }
}

/** Return the whole equality key; legacy relationships remain single-key. */
export function relationshipKeys(relationship: Pick<RelationshipDefinition, 'from' | 'to' | 'keys'>): readonly RelationshipKey[] {
  const keys = relationship.keys ?? [{ from: relationship.from, to: relationship.to }];
  validateRelationshipKeys(keys);
  if (keys[0].from !== relationship.from || keys[0].to !== relationship.to) {
    throw new Error('Relationship from/to must match the first keys pair.');
  }
  return keys;
}
