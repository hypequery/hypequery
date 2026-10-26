import { relationshipKeys } from './relationship-keys.js';
import type { RelationshipKey } from '../types.js';
import { relationshipJoinSource } from './relationship-measure-sql.js';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import { clickhouseDatasetSqlDialect } from './clickhouse-dataset-sql-dialect.js';
import { resolveRelationshipReference } from './relationship-measures.js';
/**
 * Query-builder-path planning for to-one relationship joins.
 *
 * When a dataset/metric query references relationship-qualified fields
 * (`<relationship>.<field>`), the builder path aliases the joined target with
 * the relationship name, table-qualifies base columns with the base source
 * name, and aliases joined selections back to their quoted qualified name. When
 * no qualified field is referenced, no context is produced and the builder path
 * behaves exactly as before.
 *
 * Every joined target is a projection carrying a match marker (see
 * `relationshipJoinSource`), and every joined dimension or filter reads through
 * it: a base row without a match yields NULL for the target's columns
 * regardless of the engine's `join_use_nulls` setting, so a missing or
 * other-tenant target never surfaces as `''`/`0` and never passes a `neq`
 * filter. This mirrors the Python planner.
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
  /** Joined source: the target projected with its match marker. */
  source: string;
  /** Column of `source` that is non-null only when the target matched. */
  matchMarker: string;
  keys?: readonly RelationshipKey[];
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
  /** Dialect the join sources and match guards were rendered with. */
  dialect: DatasetSqlDialectRules;
  /** `baseSource` is a join alias (a relationship), not a physical source path. */
  baseIsAlias?: boolean;
}

type QueryLike = Pick<DatasetQuery & MetricQuery, 'dimensions' | 'filters' | 'orderBy'> & Pick<DatasetQuery, 'measures'>;

/**
 * Builds the join context for a query, or returns undefined when the query
 * references no relationship-qualified fields. Validation runs first, so any
 * qualified name that fails to resolve here is skipped defensively.
 */
export function buildRelationshipBuilderContext(
  ds: AnyDatasetInstance,
  query: QueryLike,
  context?: ExecutionContext,
  dialect: DatasetSqlDialectRules = clickhouseDatasetSqlDialect,
): RelationshipBuilderContext | undefined {
  const referenced = [
    ...(query.dimensions ?? []),
    ...(query.measures ?? []),
    ...(query.filters ?? []).map((filter) => filter.field),
    ...(query.orderBy ?? []).map((order) => order.field),
  ].filter(isQualifiedField);

  if (referenced.length === 0) {
    return undefined;
  }

  const tenantPredicate = getRuntimeTenantPredicate(context);
  const joinByRelationship = new Map<string, ResolvedBuilderJoin>();

  for (const name of referenced) {
    const resolution = resolveRelationshipReference(ds, name, query.measures);
    if (!resolution || !resolution.resolved) {
      continue;
    }
    const { relationshipName, relationship, target } = resolution.resolved;
    if (joinByRelationship.has(relationshipName)) {
      continue;
    }
    const measureNames = (query.measures ?? [])
      .filter(name => name.startsWith(`${relationshipName}.`))
      .map(name => name.slice(relationshipName.length + 1));
    const keys = relationshipKeys(relationship);
    const projected = relationshipJoinSource(target, keys.map(key => key.to), measureNames, dialect);
    joinByRelationship.set(relationshipName, {
      relationship: relationshipName,
      source: projected.source,
      matchMarker: projected.marker,
      from: relationship.from,
      to: relationship.to,
      keys,
      tenant: tenantPredicate && target.tenantKey
        ? { field: target.tenantKey, ...tenantPredicate }
        : undefined,
    });
  }

  return {
    baseSource: ds.source,
    joins: Array.from(joinByRelationship.values()),
    joinByRelationship,
    dialect,
  };
}

/** Qualifies a base physical column with the base source when joins are active. */
export function qualifyBaseColumn(
  ctx: RelationshipBuilderContext | undefined,
  column: string,
  dialect: DatasetSqlDialectRules,
): string {
  // A join alias is declared unquoted, so only its column is quoted.
  return ctx?.baseIsAlias
    ? `${ctx.baseSource}.${dialect.columnReference(column)}`
    : dialect.columnReference(column, ctx?.baseSource);
}

/**
 * Resolves a relationship-qualified field to a null-guarded SQL expression:
 * the target column when the join matched, NULL otherwise
 * (`if(isNotNull(<relationship>.<marker>), <relationship>.<column>, NULL)`).
 * Throws if the name cannot be resolved, which should be unreachable after
 * validation.
 *
 * Without the guard, ClickHouse fills unmatched LEFT JOIN columns with type
 * defaults unless `join_use_nulls` is on, so an order without a customer would
 * group under `''` and pass a `neq` filter. The guard makes the planner's
 * documented NULL semantics hold whatever the server setting.
 */
export function resolveQualifiedExpression(
  ds: AnyDatasetInstance,
  name: string,
  ctx: RelationshipBuilderContext,
): string {
  const resolution = resolveQualifiedField(ds, name);
  if (!resolution || !resolution.resolved) {
    throw new Error(resolution?.error ?? `Cannot resolve relationship field "${name}".`);
  }
  const { relationshipName, targetColumn } = resolution.resolved;
  const join = ctx.joinByRelationship.get(relationshipName);
  if (!join) {
    throw new Error(`Relationship "${relationshipName}" referenced by "${name}" was not planned as a join.`);
  }
  const { dialect } = ctx;
  const matched = dialect.isNotNull(`${relationshipName}.${join.matchMarker}`);
  return dialect.ifElse(matched, `${relationshipName}.${dialect.columnReference(targetColumn)}`, 'NULL');
}

/**
 * Applies each relationship join to the builder as a single-match LEFT JOIN
 * (`leftAnyJoin`, e.g. ClickHouse `LEFT ANY JOIN`) and, when runtime tenancy
 * is active on a target, scopes the joined rows with the tenant predicate.
 *
 * A builder without `leftAnyJoin` is refused rather than downgraded to a plain
 * `leftJoin`: duplicate target keys would fan out base rows and silently
 * inflate every aggregate in the query.
 */
export function applyRelationshipJoins(
  qb: QueryBuilderLike,
  ctx: RelationshipBuilderContext | undefined,
): QueryBuilderLike {
  if (!ctx) {
    return qb;
  }
  for (const join of ctx.joins) {
    if (!qb.leftAnyJoin) {
      throw new Error(
        `Relationship "${join.relationship}" cannot be joined: the query builder does not implement ` +
        'leftAnyJoin (a single-match LEFT JOIN such as ClickHouse "LEFT ANY JOIN"). A plain leftJoin ' +
        'would fan out duplicate target keys and inflate aggregates, so relationship-qualified fields ' +
        'are unavailable with this builder.',
      );
    }
    const tenant = join.tenant
      ? {
        column: `${join.relationship}.${ctx.dialect.columnReference(join.tenant.field)}`,
        operator: join.tenant.operator,
        value: join.tenant.value,
      }
      : undefined;
    if (join.keys && join.keys.length > 1) {
      // Key-pair form; @hypequery/clickhouse >= 2.13.0.
      const pairs = join.keys.map(key =>
        [ctx.dialect.columnReference(key.from, ctx.baseSource), `${join.relationship}.${ctx.dialect.columnReference(key.to)}`] as const);
      qb = qb.leftAnyJoin(join.source, [pairs[0], ...pairs.slice(1)], join.relationship, tenant);
      continue;
    }
    qb = qb.leftAnyJoin(
      join.source,
      ctx.dialect.columnReference(join.from, ctx.baseSource),
      `${join.relationship}.${ctx.dialect.columnReference(join.to)}`,
      join.relationship,
      tenant,
    );
  }
  return qb;
}
