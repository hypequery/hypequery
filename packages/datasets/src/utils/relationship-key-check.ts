/**
 * Pure helpers for `checkRelationships`: which relationships a check covers,
 * and how a key-count row becomes a finding.
 */

import type { AnyDatasetInstance, RelationshipDefinition } from '../types.js';

export type ToOneRelationshipKind = 'belongsTo' | 'hasOne';

export interface ToOneRelationshipTarget {
  relationship: string;
  kind: ToOneRelationshipKind;
  /** Target dataset. */
  target: AnyDatasetInstance;
  /** Target join column, which a to-one declaration requires to be unique. */
  column: string;
}

/**
 * Lists the to-one relationships to check. `hasMany` is excluded because it
 * never joins, so its key has no uniqueness requirement. An explicit
 * `only` list must name declared to-one relationships.
 */
export function listToOneRelationships(
  ds: AnyDatasetInstance,
  only?: readonly string[],
): ToOneRelationshipTarget[] {
  const declared = Object.entries(ds.relationships) as Array<[string, RelationshipDefinition]>;
  if (only) {
    for (const name of only) {
      const relationship = Object.hasOwn(ds.relationships, name) ? ds.relationships[name] : undefined;
      if (!relationship) {
        throw new Error(`Unknown relationship "${name}" on dataset "${ds.name}".`);
      }
      if (relationship.kind === 'hasMany') {
        throw new Error(
          `Relationship "${name}" on dataset "${ds.name}" is hasMany; only to-one relationships have a key to check.`,
        );
      }
    }
  }
  return declared
    .filter(([name, relationship]) => relationship.kind !== 'hasMany' && (!only || only.includes(name)))
    .map(([name, relationship]) => ({
      relationship: name,
      kind: relationship.kind as ToOneRelationshipKind,
      target: relationship.target() as AnyDatasetInstance,
      column: relationship.to,
    }));
}

export interface RelationshipKeyIssue {
  relationship: string;
  kind: ToOneRelationshipKind;
  /** Target dataset name. */
  target: string;
  /** Physical target table. */
  source: string;
  /** Target join column. */
  column: string;
  /** Target rows with a non-NULL key, within the checked tenant scope. Large counts are decimal strings. */
  rows: number | string;
  /** Distinct non-NULL keys, within the checked tenant scope. Large counts are decimal strings. */
  distinctKeys: number | string;
  message: string;
}

/** Reads a count without losing precision when a driver returns UInt64 as a string. */
export function readCount(value: unknown): bigint {
  if (value == null) {
    return 0n;
  }
  if (typeof value === 'bigint' && value >= 0n) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`Expected a non-negative integer row count, received ${JSON.stringify(String(value))}.`);
}

function displayCount(count: bigint): number | string {
  return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString();
}

/**
 * Returns the finding for a to-one relationship whose target key repeats, or
 * undefined when every non-NULL key is unique.
 */
export function relationshipKeyIssue(
  entry: ToOneRelationshipTarget,
  rows: bigint,
  distinctKeys: bigint,
): RelationshipKeyIssue | undefined {
  if (rows <= distinctKeys) {
    return undefined;
  }
  const source = entry.target.source;
  return {
    relationship: entry.relationship,
    kind: entry.kind,
    target: entry.target.name,
    source,
    column: entry.column,
    rows: displayCount(rows),
    distinctKeys: displayCount(distinctKeys),
    message:
      `Relationship "${entry.relationship}" is declared ${entry.kind}, but "${source}.${entry.column}" ` +
      `has ${rows} rows for ${distinctKeys} distinct keys. Joins pick an arbitrary matching row; ` +
      'make the key unique or declare the relationship as hasMany.',
  };
}
