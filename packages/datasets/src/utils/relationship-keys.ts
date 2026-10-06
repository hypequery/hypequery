import type { RelationshipDefinition, RelationshipJoin, RelationshipKey } from '../types.js';

const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type NormalizedRelationshipJoin = Pick<RelationshipDefinition, 'from' | 'to' | 'keys'>;

/**
 * Snapshot an authored join. `{ from, to }` passes through unchanged, as it
 * always has; `keys` pairs are validated before they are interpolated into SQL.
 */
export function normalizeRelationshipJoin(join: RelationshipJoin): NormalizedRelationshipJoin {
  if (join.keys === undefined) {
    return { from: join.from, to: join.to };
  }
  if (join.from !== undefined || join.to !== undefined) {
    throw new Error('Relationship keys cannot be combined with from/to.');
  }
  const keys = join.keys;
  validateRelationshipKeys(keys);
  const copy: [RelationshipKey, ...RelationshipKey[]] = [
    Object.freeze({ from: keys[0].from, to: keys[0].to }),
    ...keys.slice(1).map(key => Object.freeze({ from: key.from, to: key.to })),
  ];
  // A single pair is the legacy relationship: contracts and catalogs carry
  // `keys` only for composite relationships, however the pair was authored.
  return { from: copy[0].from, to: copy[0].to, ...(copy.length > 1 ? { keys: Object.freeze(copy) } : {}) };
}

/**
 * Rebuild a serialized composite key. Portable records carry `keys` only for
 * composite relationships, and `from`/`to` must mirror the first pair.
 */
export function rehydrateCompositeRelationshipJoin(
  from: string,
  to: string,
  keys: readonly RelationshipKey[],
): NormalizedRelationshipJoin {
  validateRelationshipKeys(keys);
  if (keys.length < 2) {
    throw new Error('Serialized relationship keys must contain at least two pairs; single-key relationships use from/to.');
  }
  const join = normalizeRelationshipJoin({ keys });
  if (join.from !== from || join.to !== to) {
    throw new Error('Relationship from/to must match the first keys pair.');
  }
  return join;
}

export function validateRelationshipKeys(
  keys: readonly RelationshipKey[],
): asserts keys is readonly [RelationshipKey, ...RelationshipKey[]] {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('Relationship keys must be a non-empty array.');
  const from = new Set<string>();
  const to = new Set<string>();
  for (const key of keys) {
    if (!key || typeof key.from !== 'string' || typeof key.to !== 'string' || !COLUMN.test(key.from) || !COLUMN.test(key.to)) {
      throw new Error('Relationship keys must contain safe physical from/to column identifiers.');
    }
    if (from.has(key.from) || to.has(key.to)) throw new Error('Relationship keys must not repeat a source or target column.');
    from.add(key.from);
    to.add(key.to);
  }
}

/** Return the whole equality key; legacy relationships remain single-key. */
export function relationshipKeys(relationship: Pick<RelationshipDefinition, 'from' | 'to' | 'keys'>): readonly RelationshipKey[] {
  const keys = relationship.keys ?? [{ from: relationship.from, to: relationship.to }];
  if (!relationship.keys) return keys;
  validateRelationshipKeys(keys);
  if (keys[0].from !== relationship.from || keys[0].to !== relationship.to) {
    throw new Error('Relationship from/to must match the first keys pair.');
  }
  return keys;
}
