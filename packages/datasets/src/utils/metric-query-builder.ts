import { semanticQuerySyntaxErrors } from './semantic-query-syntax.js';
/** Metric SQL compilation; factory selection and execution belong to the client. */
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import type { MetricRef, MetricQuery, ExecutionContext, TimeGrain } from '../types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import {
  applyAggregationSpec,
  appendOrderLimitOffset,
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
import type { AggregationSpec, AnyDatasetInstance } from '../types.js';

export function buildMetricQueryBuilder(
  ref: MetricRef,
  spec: AggregationSpec,
  ds: AnyDatasetInstance,
  query: MetricQuery,
  grain: TimeGrain | undefined,
  builderFactory: QueryBuilderFactoryLike,
  context?: ExecutionContext,
): QueryBuilderLike {
  const syntaxErrors = semanticQuerySyntaxErrors(query);
  if (syntaxErrors.length) throw new Error(syntaxErrors.join('; '));
  const dialect = resolveDatasetSqlDialect(builderFactory);
  const joinCtx = buildRelationshipBuilderContext(ds, query, context);
  let qb: QueryBuilderLike = builderFactory.table(ds.source);
  qb = applyRelationshipJoins(qb, joinCtx);
  const { selectParts, groupByParts } = buildDimensionSelectionPlan(
    ds,
    query.dimensions ?? [],
    grain,
    joinCtx,
    query.timezone,
    dialect,
  );

  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  // Aggregation (appends to select, auto-sets groupBy on non-agg columns)
  qb = applyAggregationSpec(qb, ds, spec, ref.name, joinCtx);

  // Explicit groupBy (ensures period + dims are grouped even if aggregation auto-groupBy misses them)
  if (groupByParts.length > 0) {
    qb = qb.groupBy(groupByParts);
  }

  // Tenant auto-injection
  const tenantColumn = resolveTenantFilterColumn(ds, context);
  const tenantPredicate = getRuntimeTenantPredicate(context);
  if (tenantPredicate && tenantColumn) {
    qb = qb.where(qualifyBaseColumn(joinCtx, tenantColumn), tenantPredicate.operator, tenantPredicate.value);
  }

  // User filters
  for (const filter of query.filters ?? []) {
    if (isTenantScopedFilter(ds, filter, context)) {
      throw new Error(
        `Cannot filter on tenant field "${filter.field}" when runtime tenancy enforcement is active.`,
      );
    }
    const resolvedField = resolveFilterField(ds, filter.field, joinCtx);
    qb = qb.where(queryTimeFilterSql(ds, filter.field, resolvedField, query.timezone), filter.operator, filter.value);
  }

  // Segments: author-defined, so they resolve dimensions directly rather
  // than through the caller-facing filter allow-list.
  for (const filter of segmentFilters(ds, query.segments)) {
    qb = qb.where(resolveDimensionExpression(ds, filter.field, joinCtx), filter.operator, filter.value);
  }

  // Order, limit, offset
  qb = appendOrderLimitOffset(qb, query.orderBy, grain, query.limit, query.offset, joinCtx, dialect);

  return qb;
}
