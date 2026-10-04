import { semanticQuerySyntaxErrors, semanticOrderDirection } from './semantic-query-syntax.js';
/** Metric SQL compilation; factory selection and execution belong to the client. */
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import type { MetricRef, MetricQuery, ExecutionContext, TimeGrain } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import {
  applyAggregationSpec,
  buildDimensionSelectionPlan,
  resolveDimensionExpression,
  resolveFilterField,
  resolveTenantFilterColumn,
} from '../query-planner.js';
import { queryTimeFilterSql } from './query-timezone.js';
import { isTenantScopedFilter } from './metric-handle.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import {
  applyRelationshipJoins,
  buildRelationshipBuilderContext,
  qualifyBaseColumn,
} from './relationship-builder-plan.js';
import { segmentFilters } from './segments.js';
import type { DerivedMetricSpec } from '../types.js';
import { validateSQLIdentifier } from '../sql-utils.js';
import { isQualifiedField } from './relationship-fields.js';
import { validateDerivedCteGrouping } from './derived-cte-validation.js';

export function buildDerivedMetricSql(
  ref: MetricRef,
  spec: DerivedMetricSpec,
  query: MetricQuery,
  grain: TimeGrain | undefined,
  builderFactory: QueryBuilderFactoryLike,
  context?: ExecutionContext,
): { sql: string; params: unknown[] } {
  const syntaxErrors = semanticQuerySyntaxErrors(query);
  if (syntaxErrors.length) throw new Error(syntaxErrors.join('; '));
  const dialect = resolveDatasetSqlDialect(builderFactory);
  const ds = ref.dataset;
  const joinCtx = buildRelationshipBuilderContext(ds, query, context);

  // Build the CTE inner query using the builder
  let cteBuilder: QueryBuilderLike = builderFactory.table(ds.source);
  cteBuilder = applyRelationshipJoins(cteBuilder, joinCtx);
  const { selectParts, groupByParts } = buildDimensionSelectionPlan(
    ds,
    query.dimensions ?? [],
    grain,
    joinCtx,
    query.timezone,
    dialect,
  );

  if (selectParts.length > 0) {
    cteBuilder = cteBuilder.select(selectParts);
  }

  // Base aggregations
  const refAliases: Record<string, string> = {};
  const aggregateAliases: string[] = [];
  for (const [alias, baseMetric] of Object.entries(spec.uses)) {
    const baseSpec = baseMetric.spec;
    if (baseSpec.__type !== 'aggregation_spec') {
      throw new Error(`Derived metric "${ref.name}" references non-base metric "${alias}".`);
    }
    cteBuilder = applyAggregationSpec(cteBuilder, ds, baseSpec, alias, joinCtx);
    refAliases[alias] = alias;
    aggregateAliases.push(alias);
  }

  if (groupByParts.length > 0) {
    cteBuilder = cteBuilder.groupBy(groupByParts);
  }

  // Filters on CTE
  const tenantColumn = resolveTenantFilterColumn(ds, context);
  const tenantPredicate = getRuntimeTenantPredicate(context);
  if (tenantPredicate && tenantColumn) {
    cteBuilder = cteBuilder.where(qualifyBaseColumn(joinCtx, tenantColumn), tenantPredicate.operator, tenantPredicate.value);
  }
  for (const filter of query.filters ?? []) {
    if (isTenantScopedFilter(ds, filter, context)) {
      throw new Error(
        `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
      );
    }
    const resolvedField = resolveFilterField(ds, filter.field, joinCtx);
    cteBuilder = cteBuilder.where(queryTimeFilterSql(ds, filter.field, resolvedField, query.timezone), filter.operator, filter.value);
  }
  for (const filter of segmentFilters(ds, query.segments)) {
    cteBuilder = cteBuilder.where(
      resolveDimensionExpression(ds, filter.field, joinCtx), filter.operator, filter.value,
    );
  }

  const { sql: cteSql, parameters: cteParams } = cteBuilder.toSQLWithParams();
  const groupingErrors = validateDerivedCteGrouping(cteSql, aggregateAliases, groupByParts);
  if (groupingErrors.length > 0) {
    throw new Error(groupingErrors.join('; '));
  }

  // Outer query: trivial SELECT from the CTE — stays as string concat
  // because table('base') would fail schema typing
  const outerSelectParts: string[] = [];
  if (grain) outerSelectParts.push('period');
  for (const dim of query.dimensions ?? []) {
    // Joined dimensions surface from the CTE under their quoted qualified alias.
    if (joinCtx && isQualifiedField(dim)) {
      outerSelectParts.push(dialect.quoteIdentifier(dim));
      continue;
    }
    validateSQLIdentifier(dim, 'dimension name');
    outerSelectParts.push(dim);
  }

  const formulaExpr = spec.formula(refAliases);
  validateSQLIdentifier(ref.name, 'metric name');
  outerSelectParts.push(`${formulaExpr.toSQL()} AS ${ref.name}`);

  let sql = `WITH base AS (${cteSql}) SELECT ${outerSelectParts.join(', ')} FROM base`;

  // ORDER BY
  if (query.orderBy && query.orderBy.length > 0) {
    const orderParts = query.orderBy.map(o => {
      if (joinCtx && isQualifiedField(o.field)) {
        return `${dialect.quoteIdentifier(o.field)} ${semanticOrderDirection(o.direction)}`;
      }
      validateSQLIdentifier(o.field, 'order by field');
      return `${o.field} ${semanticOrderDirection(o.direction)}`;
    });
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  } else if (grain) {
    sql += ' ORDER BY period';
  }

  if (query.limit != null) {
    // Ensure limit is a safe integer
    const limit = Math.floor(Math.abs(query.limit));
    sql += ` LIMIT ${limit}`;
  }
  if (query.offset != null) {
    // Ensure offset is a safe integer
    const offset = Math.floor(Math.abs(query.offset));
    sql += ` OFFSET ${offset}`;
  }

  return { sql, params: cteParams };
}
