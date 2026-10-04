import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import { queryTimeFilterSql } from './query-timezone.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { baseMeasureNames, getBaseMeasure } from './dataset-measures.js';
import type {
  AnyDatasetInstance,
  DatasetQuery,
} from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import {
  appendOrderLimitOffset,
  applyMeasureDefinition,
  buildDimensionSelectionPlan,
  resolveDimensionExpression,
  resolveFilterField,
  resolveTenantFilterColumn,
} from '../query-planner.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import {
  applyRelationshipJoins,
  buildRelationshipBuilderContext,
  qualifyBaseColumn,
} from './relationship-builder-plan.js';
import {
  hasSelectedDerivedMeasure,
} from './dataset-derived-query.js';
import { segmentFilters } from './segments.js';

import type { DatasetQueryExecutionOptions } from '../dataset-query.js';

export function buildDatasetQueryBuilder(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): QueryBuilderLike {
  if (selectedTimeMeasures(ds, query).size) {
    throw new Error('A time-based dataset query needs the time-measure SQL planner; use createDatasetClient().toSQL().');
  }
  if (hasSelectedDerivedMeasure(ds, query)) {
    throw new Error('A derived dataset query needs the outer SQL projection; use createDatasetClient().toSQL().');
  }
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  const dialect = resolveDatasetSqlDialect(options.builderFactory);
  const joinCtx = buildRelationshipBuilderContext(ds, query, options.context);

  let qb = options.builderFactory.table(ds.source);
  qb = applyRelationshipJoins(qb, joinCtx);
  const { selectParts, groupByParts } = buildDimensionSelectionPlan(ds, query.dimensions ?? [], query.by, joinCtx, query.timezone, dialect);
  const measureNames = query.measures ?? baseMeasureNames(ds.measures);

  if (selectParts.length > 0) {
    qb = qb.select(selectParts);
  }

  for (const measureName of measureNames) {
    const definition = getBaseMeasure(ds.measures, measureName);
    if (!definition) throw new Error(`Measure "${measureName}" is not a base measure.`);
    qb = applyMeasureDefinition(qb, ds, measureName, definition, joinCtx);
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
    qb = qb.where(queryTimeFilterSql(ds, filter.field, resolvedField, query.timezone), filter.operator, filter.value);
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
    dialect,
  );
}

