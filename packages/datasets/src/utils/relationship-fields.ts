/**
 * Resolution helpers for relationship-qualified field names (`relationship.field`).
 *
 * v1 supports one hop over to-one relationships (`belongsTo`, `hasOne`) only,
 * addressing dimensions declared on the target dataset. `hasMany` stays
 * metadata-only to avoid fan-out corruption of aggregates. See
 * `plans/relationship-aware-semantics-design.md`.
 */

import type {
  AnyDatasetInstance,
  DimensionDefinition,
  RelationshipDefinition,
} from '../types.js';

/**
 * Enumerates the queryable qualified field names (`<name>.<dimension>`) a
 * relationship contributes, applying the same rules `resolveQualifiedField`
 * enforces at query time: `hasMany` contributes nothing and SQL-backed target
 * dimensions are excluded. Keep the two in sync — the catalog, contract, and
 * generated input schemas all advertise exactly this list.
 */
export function listQueryableRelationshipFields(
  name: string,
  relationship: RelationshipDefinition,
): string[] {
  if (relationship.kind === 'hasMany') {
    return [];
  }
  const target = relationship.target() as Partial<AnyDatasetInstance> | undefined;
  return Object.entries(target?.dimensions ?? {})
    .filter(([, dimension]) => !dimension.sql)
    .map(([field]) => `${name}.${field}`);
}

export interface ParsedQualifiedField {
  /** The relationship name (prefix before the first dot). */
  relationship: string;
  /** Everything after the first dot — the target field, possibly multi-hop. */
  field: string;
}

/** True when a field name is relationship-qualified (contains a dot). */
export function isQualifiedField(name: string): boolean {
  return name.includes('.');
}

/**
 * Splits a qualified name into its relationship prefix and remaining field.
 * Returns null when `name` is not qualified (no dot), so callers can treat it
 * as a local field.
 */
export function parseQualifiedField(name: string): ParsedQualifiedField | null {
  const dot = name.indexOf('.');
  if (dot === -1) {
    return null;
  }
  return { relationship: name.slice(0, dot), field: name.slice(dot + 1) };
}

export interface ResolvedQualifiedField {
  /** Relationship name, also used as the SQL table alias / qualified prefix. */
  relationshipName: string;
  relationship: RelationshipDefinition;
  /** The resolved target dataset instance. */
  target: AnyDatasetInstance;
  /** Target dimension name (the allowlist key on the target). */
  targetDimensionName: string;
  targetDimension: DimensionDefinition;
  /** Physical column backing the target dimension. */
  targetColumn: string;
  /** The qualified name exactly as referenced, e.g. `customer.country`. */
  qualifiedName: string;
}

export type QualifiedFieldResolution =
  | { resolved: ResolvedQualifiedField; error?: undefined }
  | { resolved?: undefined; error: string };

/**
 * Resolves a relationship-qualified field name against a base dataset.
 *
 * Returns null when `name` is not qualified (caller handles it as a local
 * field). Otherwise returns either the resolved to-one target dimension or an
 * actionable validation error (unknown relationship, multi-hop, `hasMany`,
 * unknown target dimension, or SQL-backed target dimension).
 */
export function resolveQualifiedField(
  ds: AnyDatasetInstance,
  name: string,
): QualifiedFieldResolution | null {
  const parsed = parseQualifiedField(name);
  if (!parsed) {
    return null;
  }

  const { relationship: relationshipName, field } = parsed;
  const relationship = ds.relationships[relationshipName];
  if (!relationship) {
    const available = Object.keys(ds.relationships);
    return {
      error: available.length > 0
        ? `Unknown relationship "${relationshipName}" in field "${name}" on dataset "${ds.name}". Available relationships: ${available.join(', ')}.`
        : `Unknown field "${name}": dataset "${ds.name}" declares no relationships.`,
    };
  }

  if (field.includes('.')) {
    return {
      error: `Multi-hop relationship path "${name}" is not supported. Only a single hop is allowed (e.g. "${relationshipName}.<field>").`,
    };
  }

  if (relationship.kind === 'hasMany') {
    return {
      error: `Relationship "${relationshipName}" on dataset "${ds.name}" is a hasMany (to-many) relationship and is not queryable, because joining it would fan out and corrupt aggregates. It remains available as metadata only.`,
    };
  }

  const target = relationship.target() as AnyDatasetInstance;
  const targetDimension = target.dimensions[field];
  if (!targetDimension) {
    const available = Object.keys(target.dimensions);
    return {
      error: `Unknown dimension "${field}" on relationship "${relationshipName}" (target dataset "${target.name}"). Available: ${available.join(', ')}.`,
    };
  }

  if (targetDimension.sql) {
    return {
      error: `Dimension "${name}" is SQL-backed on target dataset "${target.name}"; SQL-backed dimensions are not yet queryable through relationships.`,
    };
  }

  return {
    resolved: {
      relationshipName,
      relationship,
      target,
      targetDimensionName: field,
      targetDimension,
      targetColumn: targetDimension.column ?? field,
      qualifiedName: name,
    },
  };
}
