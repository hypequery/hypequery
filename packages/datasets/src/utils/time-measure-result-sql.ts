import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { getDerivedMeasure } from './dataset-measures.js';
import { derivedProjection } from './derived-measure-sql.js';
import type { TimeMeasureSqlDimension } from './time-measure-source-sql.js';

/** Evaluate formulas after aggregation, then apply output ordering and pagination. */
export function buildTimeMeasureResultSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
  dims: readonly TimeMeasureSqlDimension[],
  ctes: readonly string[],
  validationGuard: string,
  formulasEvaluated = false,
): string {
  const selected = query.measures ?? [];
  const projections = [
    quoteSQLIdentifier('period'),
    ...dims.map(dimension => quoteSQLIdentifier(dimension.name)),
    ...selected.map(name => {
      const derived = getDerivedMeasure(ds.measures, name);
      return derived && !formulasEvaluated ? derivedProjection(name, derived) : quoteSQLIdentifier(name);
    }),
  ];
  // Keep toSQL independently guarded too. This branch produces no valid
  // result rows, and forces axis validation even when _hq_values is empty.
  const outputNames = ['period', ...dims.map(dimension => dimension.name), ...selected];
  const nullProjections = outputNames.map(name => `NULL AS ${quoteSQLIdentifier(name)}`).join(', ');
  const resultCte = `_hq_result AS (SELECT ${projections.join(', ')} FROM _hq_values`
    + ` UNION ALL SELECT ${nullProjections} FROM _hq_bounds WHERE ${validationGuard} = 1)`;
  let sql = `WITH ${[...ctes, resultCte].join(',\n')} SELECT ${outputNames.map(quoteSQLIdentifier).join(', ')} FROM _hq_result`;
  const order = query.orderBy?.length ? query.orderBy : [{ field: 'period', direction: 'asc' }];
  sql += ` ORDER BY ${order.map(item => `${quoteSQLIdentifier(item.field)} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`;
  const limit = options.executionLimit ?? query.limit;
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (query.offset !== undefined) sql += ` OFFSET ${query.offset}`;
  return sql;
}
