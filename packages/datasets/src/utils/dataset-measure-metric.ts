import type { DatasetQuery, DatasetMeasureMetricSpec, MetricQuery, MetricRef, TimeGrain } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { buildDatasetQueryBuilder } from '../dataset-query.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { buildTimeMeasureDatasetSql } from './time-measure-dataset-sql.js';
import { buildDerivedDatasetSql, hasSelectedDerivedMeasure } from './dataset-derived-query.js';

/** The metric name is an output alias; its measure remains dataset-owned. */
export function datasetMeasureMetricQuery(ref: MetricRef, spec: DatasetMeasureMetricSpec, query: MetricQuery, grain?: TimeGrain): DatasetQuery {
  return { ...query, by: grain, measures: [spec.measure],
    orderBy: query.orderBy?.map(order => ({ ...order, field: order.field === ref.name ? spec.measure : order.field })),
  };
}

export function buildDatasetMeasureMetricSql(ref: MetricRef, spec: DatasetMeasureMetricSpec, query: MetricQuery, grain: TimeGrain | undefined, options: DatasetQueryExecutionOptions) {
  const datasetQuery = datasetMeasureMetricQuery(ref, spec, query, grain);
  const built = selectedTimeMeasures(ref.dataset, datasetQuery).size
    ? buildTimeMeasureDatasetSql(ref.dataset, datasetQuery, options)
    : hasSelectedDerivedMeasure(ref.dataset, datasetQuery)
      ? buildDerivedDatasetSql(ref.dataset, datasetQuery, options, buildDatasetQueryBuilder)
      : buildDatasetQueryBuilder(ref.dataset, datasetQuery, options).toSQLWithParams();
  const projections = [...(grain ? ['period'] : []), ...(query.dimensions ?? [])].map(quoteSQLIdentifier);
  projections.push(`${quoteSQLIdentifier(spec.measure)} AS ${quoteSQLIdentifier(ref.name)}`);
  let sql = `SELECT ${projections.join(', ')} FROM (${built.sql}) AS _hq_metric`;
  const order = query.orderBy?.length ? query.orderBy : grain ? [{ field: 'period', direction: 'asc' }] : [];
  if (order.length) sql += ` ORDER BY ${order.map(item => `${quoteSQLIdentifier(item.field)} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`;
  return { sql, parameters: built.parameters, timeAxisSql: 'timeAxisSql' in built && typeof built.timeAxisSql === 'string' ? built.timeAxisSql : undefined };
}
