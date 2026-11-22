import { calculationColumns } from './query-calculation-outputs.js';
import { baseMeasureNames } from './dataset-measures.js';
import type {
  AnyDatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
  ExecutionContext,
} from '../types.js';
import { applyPagination } from './pagination.js';
import { serializeSemanticMeasureValues } from './semantic-result-serialization.js';
import { getRuntimeTenantId } from './tenant-runtime.js';

/** Apply the same result contract to builder-backed and derived dataset queries. */
export function toDatasetQueryResult(
  rows: Record<string, unknown>[],
  options: {
    dataset: AnyDatasetInstance;
    query: DatasetQuery;
    sql: string;
    timingMs: number;
    context?: ExecutionContext;
  },
): DatasetQueryResult {
  const { dataset, query, sql, timingMs, context } = options;
  const selectedMeasures = query.measures ?? baseMeasureNames(dataset.measures);
  const { data, pagination } = applyPagination(rows, query.limit, query.offset);
  // RFC 0026 outputs are measure values too, serialized the same way.
  const calculations = calculationColumns(query);
  const serializedData = serializeSemanticMeasureValues(data, [
    ...selectedMeasures, ...calculations.map(column => column.name),
  ]);

  return {
    data: serializedData,
    meta: {
      sql,
      timingMs,
      tenant: getRuntimeTenantId(context),
      rowCount: serializedData.length,
      pagination,
      ...(calculations.length === 0 ? {} : { calculations }),
    },
  };
}
