import { measureDependencyNames } from './measure-dependencies.js';
import { derivedExpressionSql } from './derived-measure-sql.js';
import { baseMeasureNames, getBaseMeasure, getDerivedMeasure } from './dataset-measures.js';
import type { AnyDatasetInstance, DatasetQuery, DatasetQueryResult } from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { overfetchLimit } from './pagination.js';
import { toDatasetQueryResult } from './dataset-query-result.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';

type BuildBaseQuery = (
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
) => QueryBuilderLike;

export function hasSelectedDerivedMeasure(ds: AnyDatasetInstance, query: DatasetQuery): boolean {
  return (query.measures ?? []).some(name => getDerivedMeasure(ds.measures, name) !== undefined);
}

export function buildDerivedDatasetSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  buildBaseQuery: BuildBaseQuery,
): { sql: string; parameters: unknown[] } {
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) {
    throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  }

  const selected = query.measures ?? baseMeasureNames(ds.measures);
  const baseMeasures = measureDependencyNames(ds.measures, selected).filter(name => getBaseMeasure(ds.measures, name));
  const resolve = (name: string): string => {
    const derived = getDerivedMeasure(ds.measures, name);
    return derived ? `(${derivedExpressionSql(derived, resolve)})` : quoteSQLIdentifier(name);
  };
  const inner = buildBaseQuery(ds, {
    ...query,
    measures: [...baseMeasures],
    orderBy: undefined,
    limit: undefined,
    offset: undefined,
  }, { ...options, executionLimit: undefined, skipDefaultOrderBy: true });
  const { sql: innerSql, parameters } = inner.toSQLWithParams();

  const projections: string[] = [];
  if (query.by) projections.push(quoteSQLIdentifier('period'));
  for (const dimension of query.dimensions ?? []) projections.push(quoteSQLIdentifier(dimension));
  for (const name of selected) {
    const derived = getDerivedMeasure(ds.measures, name);
    projections.push(derived
      ? `${derivedExpressionSql(derived, resolve)} AS ${quoteSQLIdentifier(name)}`
      : quoteSQLIdentifier(name));
  }
  let sql = `WITH base AS (${innerSql}) SELECT ${projections.join(', ')} FROM base`;

  if (query.orderBy?.length) {
    sql += ` ORDER BY ${query.orderBy.map(order => (
      `${quoteSQLIdentifier(order.field)} ${order.direction === 'asc' ? 'ASC' : 'DESC'}`
    )).join(', ')}`;
  } else if (query.by) {
    sql += ` ORDER BY ${quoteSQLIdentifier('period')} ASC`;
  }
  const limit = options.executionLimit ?? query.limit;
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (query.offset !== undefined) sql += ` OFFSET ${query.offset}`;
  return { sql, parameters };
}

export async function runDerivedDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  buildBaseQuery: BuildBaseQuery,
): Promise<DatasetQueryResult> {
  const start = Date.now();
  const { sql, parameters } = buildDerivedDatasetSql(ds, query, {
    ...options,
    executionLimit: overfetchLimit(query.limit),
  }, buildBaseQuery);
  const rows = await options.builderFactory.rawQuery<Record<string, unknown>>(
    sql, parameters, { abortSignal: options.context?.abortSignal },
  );
  return toDatasetQueryResult(rows, {
    dataset: ds,
    query,
    sql,
    timingMs: Date.now() - start,
    context: options.context,
  });
}
