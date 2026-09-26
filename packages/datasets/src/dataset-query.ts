import type {
  AnyDatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
  ExecutionContext,
} from './types.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';
import {
  appendOrderLimitOffset,
  applyMeasureDefinition,
  buildDimensionSelectionPlan,
  resolveDimensionExpression,
  resolveFilterField,
  resolveTenantFilterColumn,
} from './query-planner.js';
import { type ValidationResult } from './validation.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';
import { getRuntimeTenantPredicate } from './utils/tenant-runtime.js';
import { overfetchLimit } from './utils/pagination.js';
import {
  applyRelationshipJoins,
  buildRelationshipBuilderContext,
  qualifyBaseColumn,
} from './utils/relationship-builder-plan.js';
import {
  hasSelectedDerivedMeasure,
  runDerivedDatasetQuery,
} from './utils/dataset-derived-query.js';
import { toDatasetQueryResult } from './utils/dataset-query-result.js';
import { segmentFilters } from './utils/segments.js';

export interface DatasetQueryExecutionOptions {
  builderFactory: QueryBuilderFactoryLike;
  context?: ExecutionContext;
  /**
   * Overrides the SQL `LIMIT` without affecting validation (which still uses
   * `query.limit`). Used to over-fetch one row for pagination's `hasMore`.
   */
  executionLimit?: number;
  /** Internal: the grouped subquery is unordered; the derived outer query orders results. */
  skipDefaultOrderBy?: boolean;
}

export function validateDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): ValidationResult {
  return validateDatasetQueryInput(ds, query, context);
}

export function buildDatasetQueryBuilder(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): QueryBuilderLike {
  if (hasSelectedDerivedMeasure(ds, query)) {
    throw new Error('A derived dataset query needs the outer SQL projection; use createDatasetClient().toSQL().');
  }
  const validation = validateDatasetQuery(ds, query, options.context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  const joinCtx = buildRelationshipBuilderContext(ds, query, options.context);

  let qb = options.builderFactory.table(ds.source);
  qb = applyRelationshipJoins(qb, joinCtx);
  const { selectParts, groupByParts } = buildDimensionSelectionPlan(ds, query.dimensions ?? [], query.by, joinCtx);
  const measureNames = query.measures ?? Object.keys(ds.measures);

  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  for (const measureName of measureNames) {
    qb = applyMeasureDefinition(qb, ds, measureName, ds.measures[measureName], joinCtx);
  }

  if (groupByParts.length > 0) {
    qb = qb.groupBy(groupByParts);
  }

  const tenantColumn = resolveTenantFilterColumn(ds, options.context);
  const tenantPredicate = getRuntimeTenantPredicate(options.context);
  if (tenantPredicate && tenantColumn) {
    qb = qb.where(qualifyBaseColumn(joinCtx, tenantColumn), tenantPredicate.operator, tenantPredicate.value);
  }

  for (const filter of query.filters ?? []) {
    const resolvedField = resolveFilterField(ds, filter.field, joinCtx);
    qb = qb.where(resolvedField, filter.operator, filter.value);
  }

  // Segments are author-defined, so they bypass the caller filter allow-list.
  for (const filter of segmentFilters(ds, query.segments)) {
    qb = qb.where(resolveDimensionExpression(ds, filter.field, joinCtx), filter.operator, filter.value);
  }

  return appendOrderLimitOffset(
    qb,
    query.orderBy,
    options.skipDefaultOrderBy ? undefined : query.by,
    options.executionLimit ?? query.limit,
    query.offset,
    joinCtx,
  );
}

export async function runDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): Promise<DatasetQueryResult> {
  if (hasSelectedDerivedMeasure(ds, query)) {
    return runDerivedDatasetQuery(ds, query, options, buildDatasetQueryBuilder);
  }

  const start = Date.now();
  // Over-fetch one row so we can report `hasMore` without a count query.
  const qb = buildDatasetQueryBuilder(ds, query, {
    ...options,
    executionLimit: overfetchLimit(query.limit),
  });
  const rows = await qb.execute({ abortSignal: options.context?.abortSignal });
  return toDatasetQueryResult(rows, {
    dataset: ds,
    query,
    sql: qb.toSQLWithParams().sql,
    timingMs: Date.now() - start,
    context: options.context,
  });
}
