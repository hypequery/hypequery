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
  resolveFilterField,
  resolveTenantFilterColumn,
} from './query-planner.js';
import { type ValidationResult } from './validation.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';
import {
  getRuntimeTenantId,
  getRuntimeTenantPredicate,
} from './utils/tenant-runtime.js';

function toResultMeta(
  qb: QueryBuilderLike,
  timingMs: number,
  context?: ExecutionContext,
) {
  return {
    sql: qb.toSQLWithParams().sql,
    timingMs,
    tenant: getRuntimeTenantId(context),
  };
}

export interface DatasetQueryExecutionOptions {
  builderFactory: QueryBuilderFactoryLike;
  context?: ExecutionContext;
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
  const validation = validateDatasetQuery(ds, query, options.context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  let qb = options.builderFactory.table(ds.source);
  const { selectParts, groupByParts } = buildDimensionSelectionPlan(ds, query.dimensions ?? [], query.by);
  const measureNames = query.measures ?? Object.keys(ds.measures);

  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  for (const measureName of measureNames) {
    qb = applyMeasureDefinition(qb, ds, measureName, ds.measures[measureName]);
  }

  if (groupByParts.length > 0) {
    qb = qb.groupBy(groupByParts);
  }

  const tenantColumn = resolveTenantFilterColumn(ds, options.context);
  const tenantPredicate = getRuntimeTenantPredicate(options.context);
  if (tenantPredicate && tenantColumn) {
    qb = qb.where(tenantColumn, tenantPredicate.operator, tenantPredicate.value);
  }

  for (const filter of query.filters ?? []) {
    const resolvedField = resolveFilterField(ds, filter.field);
    qb = qb.where(resolvedField, filter.operator, filter.value);
  }

  return appendOrderLimitOffset(
    qb,
    query.orderBy,
    query.by,
    query.limit,
    query.offset,
  );
}

export async function runDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): Promise<DatasetQueryResult> {
  const start = Date.now();
  const qb = buildDatasetQueryBuilder(ds, query, options);
  const data = await qb.execute();
  return {
    data,
    meta: toResultMeta(qb, Date.now() - start, options.context),
  };
}
