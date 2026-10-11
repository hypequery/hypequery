import { queryMeasureDefinitions } from './relationship-measures.js';
import { semanticOrderDirection } from './semantic-query-syntax.js';
import { measureDependencyNames } from './measure-dependencies.js';
import { derivedExpressionSql } from './derived-measure-sql.js';
import { baseMeasureNames, getBaseMeasure, getDerivedMeasure } from './dataset-measures.js';
import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import type { QueryBuilderLike } from '../query-builder-protocol.js';
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { datasetHavingSql } from './dataset-having.js';

type BuildBaseQuery = (
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
) => QueryBuilderLike;

export function hasSelectedDerivedMeasure(ds: AnyDatasetInstance, query: DatasetQuery): boolean {
  return (query.measures ?? []).some(name => getDerivedMeasure(ds.measures, name) !== undefined);
}

/**
 * True when the query needs an outer query over the grouped result: derived
 * measures are computed there, and `having` conditions filter there.
 */
export function needsOuterDatasetQuery(ds: AnyDatasetInstance, query: DatasetQuery): boolean {
  return hasSelectedDerivedMeasure(ds, query) || (query.having?.length ?? 0) > 0;
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

  const dialect = resolveDatasetSqlDialect(options.builderFactory);
  const selected = query.measures ?? baseMeasureNames(ds.measures);
  const baseMeasures = measureDependencyNames(queryMeasureDefinitions(ds, selected), selected).filter(name => name.includes('.') || getBaseMeasure(ds.measures, name));
  const resolve = (name: string): string => {
    const derived = getDerivedMeasure(ds.measures, name);
    return derived ? `(${derivedExpressionSql(derived, resolve)})` : dialect.quoteIdentifier(name);
  };
  const inner = buildBaseQuery(ds, {
    ...query,
    measures: [...baseMeasures],
    having: undefined,
    orderBy: undefined,
    limit: undefined,
    offset: undefined,
  }, { ...options, executionLimit: undefined, skipDefaultOrderBy: true });
  const { sql: innerSql, parameters } = inner.toSQLWithParams();

  const projections: string[] = [];
  if (query.by) projections.push(dialect.quoteIdentifier('period'));
  for (const dimension of query.dimensions ?? []) projections.push(dialect.quoteIdentifier(dimension));
  for (const name of selected) {
    const derived = getDerivedMeasure(ds.measures, name);
    projections.push(derived
      ? `${derivedExpressionSql(derived, resolve)} AS ${dialect.quoteIdentifier(name)}`
      : dialect.quoteIdentifier(name));
  }
  let sql = `WITH base AS (${innerSql}) SELECT ${projections.join(', ')} FROM base`;

  // Conditions read the same expression the projection does, never the output
  // alias, so the predicate stays valid on dialects without alias resolution.
  if (query.having?.length) {
    const having = datasetHavingSql(query.having, resolve);
    sql += ` WHERE ${having.sql}`;
    parameters.push(...having.parameters);
  }

  if (query.orderBy?.length) {
    sql += ` ORDER BY ${query.orderBy.map(order => (
      `${dialect.quoteIdentifier(order.field)} ${semanticOrderDirection(order.direction)}`
    )).join(', ')}`;
  } else if (query.by) {
    sql += ` ORDER BY ${dialect.quoteIdentifier('period')} ASC`;
  }
  const limit = options.executionLimit ?? query.limit;
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (query.offset !== undefined) sql += ` OFFSET ${query.offset}`;
  return { sql, parameters };
}
