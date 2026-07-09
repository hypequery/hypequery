/**
 * Query-builder-path planning for to-one relationship joins.
 *
 * When a dataset/metric query references relationship-qualified fields
 * (`<relationship>.<field>`), the builder path aliases the joined target with
 * the relationship name, table-qualifies base columns with the base source
 * name, and aliases joined selections back to their quoted qualified name. When
 * no qualified field is referenced, no context is produced and the builder path
 * behaves exactly as before.
 */

import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricQuery,
} from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { getRuntimeTenantPredicate, type TenantPredicate } from './tenant-runtime.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';

export interface ResolvedBuilderJoin {
  /** Relationship name, used as the joined table's SQL alias. */
  relationship: string;
  /** Physical target source table. */
  source: string;
  /** Base join column (unqualified). */
  from: string;
  /** Target join column (unqualified). */
  to: string;
  /** Tenant predicate applied to the joined target, when active. */
  tenant?: TenantPredicate & { field: string };
}

export interface RelationshipBuilderContext {
  baseSource: string;
  joins: ResolvedBuilderJoin[];
  joinByRelationship: Map<string, ResolvedBuilderJoin>;
}

type QueryLike = Pick<DatasetQuery & MetricQuery, 'dimensions' | 'filters' | 'orderBy'>;

/**
 * Builds the join context for a query, or returns undefined when the query
 * references no relationship-qualified fields. Validation runs first, so any
 * qualified name that fails to resolve here is skipped defensively.
 */
export function buildRelationshipBuilderContext(
  ds: AnyDatasetInstance,
  query: QueryLike,
  context?: ExecutionContext,
): RelationshipBuilderContext | undefined {
  const referenced = [
    ...(query.dimensions ?? []),
    ...(query.filters ?? []).map((filter) => filter.field),
    ...(query.orderBy ?? []).map((order) => order.field),
  ].filter(isQualifiedField);

  if (referenced.length === 0) {
    return undefined;
  }

  const tenantPredicate = getRuntimeTenantPredicate(context);
  const joinByRelationship = new Map<string, ResolvedBuilderJoin>();

  for (const name of referenced) {
    const resolution = resolveQualifiedField(ds, name);
    if (!resolution || !resolution.resolved) {
      continue;
    }
    const { relationshipName, relationship, target } = resolution.resolved;
    if (joinByRelationship.has(relationshipName)) {
      continue;
    }
    joinByRelationship.set(relationshipName, {
      relationship: relationshipName,
      source: target.source,
      from: relationship.from,
      to: relationship.to,
      tenant: tenantPredicate && target.tenantKey
        ? { field: target.tenantKey, ...tenantPredicate }
        : undefined,
    });
  }

  return {
    baseSource: ds.source,
    joins: Array.from(joinByRelationship.values()),
    joinByRelationship,
  };
}

/** Qualifies a base physical column with the base source when joins are active. */
export function qualifyBaseColumn(
  ctx: RelationshipBuilderContext | undefined,
  column: string,
): string {
  return ctx ? `${ctx.baseSource}.${column}` : column;
}

/**
 * Resolves a relationship-qualified field to its SQL column reference
 * (`<relationship>.<targetColumn>`). Throws if the name cannot be resolved,
 * which should be unreachable after validation.
 */
export function resolveQualifiedColumn(
  ds: AnyDatasetInstance,
  name: string,
): string {
  const resolution = resolveQualifiedField(ds, name);
  if (!resolution || !resolution.resolved) {
    throw new Error(resolution?.error ?? `Cannot resolve relationship field "${name}".`);
  }
  const { relationshipName, targetColumn } = resolution.resolved;
  return `${relationshipName}.${targetColumn}`;
}

/**
 * Applies each relationship LEFT JOIN to the builder and, when runtime tenancy
 * is active on a target, scopes the joined rows with the tenant predicate.
 */
export function applyRelationshipJoins(
  qb: QueryBuilderLike,
  ctx: RelationshipBuilderContext | undefined,
): QueryBuilderLike {
  if (!ctx) {
    return qb;
  }
  for (const join of ctx.joins) {
    qb = qb.leftJoin(
      join.source,
      `${ctx.baseSource}.${join.from}`,
      `${join.relationship}.${join.to}`,
      join.relationship,
    );
    if (join.tenant) {
      // NOTE: applying the tenant predicate in WHERE (rather than the JOIN ON
      // clause) turns this LEFT JOIN into an effective INNER JOIN — base rows
      // whose FK matches a different tenant, or no target at all, are dropped
      // instead of surviving with undefined joined columns (as the in-memory
      // backend does). Correct LEFT semantics require an ON-clause predicate,
      // which needs `leftJoin` to carry extra conditions; that lands with the
      // @hypequery/clickhouse join changes in PR 2. Until then this over-filters
      // (safe: it never leaks cross-tenant rows).
      qb = qb.where(
        `${join.relationship}.${join.tenant.field}`,
        join.tenant.operator,
        join.tenant.value,
      );
    }
  }
  return qb;
}
