import type { ExecutionContext, MetricQuery, MetricResult } from '../types.js';
import { applyPagination } from './pagination.js';
import { serializeSemanticMeasureValues } from './semantic-result-serialization.js';
import { getRuntimeTenantId } from './tenant-runtime.js';

/** Keep base and derived metric execution on the same result contract. */
export function toMetricQueryResult<T>(
  rows: T[],
  options: {
    metric: string;
    query: MetricQuery;
    sql: string;
    timingMs: number;
    context?: ExecutionContext;
  },
): MetricResult<T> {
  const { data, pagination } = applyPagination(rows, options.query.limit, options.query.offset);
  const serializedData = serializeSemanticMeasureValues(data, [options.metric]);
  return {
    data: serializedData,
    meta: {
      sql: options.sql,
      timingMs: options.timingMs,
      tenant: getRuntimeTenantId(options.context),
      rowCount: serializedData.length,
      pagination,
    },
  };
}
