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
import { queryTimeFilter } from './query-timezone.js';
import { StatementParameters, type PlannedStatement } from './statement-parameters.js';
import { formulaExpressionSql } from './derived-measure-sql.js';
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
): PlannedStatement {
  const syntaxErrors = semanticQuerySyntaxErrors(query);
  if (syntaxErrors.length) throw new Error(syntaxErrors.join('; '));
  const dialect = resolveDatasetSqlDialect(builderFactory);
  const ds = ref.dataset;
  const joinCtx = buildRelationshipBuilderContext(ds, query, context, dialect);

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

  // Group before aggregating: the builder only infers GROUP BY when none is
  // set, and cannot infer it from quoted aliases.
  if (groupByParts.length > 0) {
    cteBuilder = cteBuilder.groupBy(groupByParts);
  }

  // Base aggregations
  const refAliases: Record<string, string> = {};
  const inputNames: Record<string, string> = {};
  const aggregateAliases: string[] = [];
  for (const [alias, baseMetric] of Object.entries(spec.uses)) {
    const baseSpec = baseMetric.spec;
    if (baseSpec.__type !== 'aggregation_spec') {
      throw new Error(`Derived metric "${ref.name}" references non-base metric "${alias}".`);
    }
    const quoted = dialect.quoteIdentifier(alias);
    cteBuilder = applyAggregationSpec(cteBuilder, ds, baseSpec, alias, joinCtx, dialect);
    refAliases[alias] = quoted;
    inputNames[alias] = alias;
    aggregateAliases.push(quoted);
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
    for (const predicate of queryTimeFilter(dialect, ds, filter, resolvedField, query.timezone)) {
      cteBuilder = cteBuilder.where(predicate.expression, predicate.operator, predicate.value);
    }
  }
  for (const filter of segmentFilters(ds, query.segments)) {
    const predicates = queryTimeFilter(dialect, ds, filter, resolveDimensionExpression(ds, filter.field, joinCtx), query.timezone, { field: 'dimension' });
    for (const predicate of predicates) {
      cteBuilder = cteBuilder.where(predicate.expression, predicate.operator, predicate.value);
    }
  }

  // Check the builder's own SQL: embedded text may be an opaque block marker.
  // Replaced by a plan-level check in HQ-197.
  const cteStatement = cteBuilder.toSQLWithParams();
  const groupingErrors = validateDerivedCteGrouping(cteStatement.sql, aggregateAliases, groupByParts);
  if (groupingErrors.length > 0) {
    throw new Error(groupingErrors.join('; '));
  }

  // Outer query: trivial SELECT from the CTE — stays as string concat
  // because table('base') would fail schema typing
  const outerSelectParts: string[] = [];
  if (grain) outerSelectParts.push(dialect.quoteIdentifier('period'));
  for (const dim of query.dimensions ?? []) {
    // Joined dimensions surface from the CTE under their quoted qualified alias.
    if (!(joinCtx && isQualifiedField(dim))) validateSQLIdentifier(dim, 'dimension name');
    outerSelectParts.push(dialect.quoteIdentifier(dim));
  }

  // Render through the dialect, like derived measures. FormulaExpr.toSQL()
  // is kept for definition identity, not for planning.
  validateSQLIdentifier(ref.name, 'metric name');
  const formulaSql = formulaExpressionSql(dialect, spec.formula(inputNames).expression, name => {
    const quoted = refAliases[name];
    if (quoted === undefined || !Object.hasOwn(refAliases, name)) {
      throw new Error(`Derived metric "${ref.name}" formula references undeclared input "${name}".`);
    }
    return quoted;
  });
  outerSelectParts.push(`${formulaSql} AS ${dialect.quoteIdentifier(ref.name)}`);

  const parameters = new StatementParameters(dialect);
  let text = `WITH base AS (${parameters.embedBuilder(cteBuilder, cteStatement)}) SELECT ${outerSelectParts.join(', ')} FROM base`;

  // ORDER BY
  if (query.orderBy && query.orderBy.length > 0) {
    const orderParts = query.orderBy.map(o => {
      if (!(joinCtx && isQualifiedField(o.field))) validateSQLIdentifier(o.field, 'order by field');
      return dialect.orderTerm(dialect.quoteIdentifier(o.field), semanticOrderDirection(o.direction));
    });
    text += ` ORDER BY ${orderParts.join(', ')}`;
  } else if (grain) {
    text += ` ORDER BY ${dialect.orderTerm(dialect.quoteIdentifier('period'))}`;
  }

  // Ensure limit and offset are safe integers.
  text += dialect.paginate(
    query.limit != null ? Math.floor(Math.abs(query.limit)) : undefined,
    query.offset != null ? Math.floor(Math.abs(query.offset)) : undefined,
  );

  return { text, parameters };
}
