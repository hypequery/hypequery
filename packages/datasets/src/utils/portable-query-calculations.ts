/**
 * RFC 0026 fields of a validated portable query, in the dataset client's
 * shape: identifiers become strings and a filter calculation's `where`
 * comparisons become `{ field, operator, value }` filters, exactly as the
 * query's own `filters` do.
 */

import type { ProtocolDatasetQuery } from '@hypequery/protocol';
import { PortableExecutionUnsupportedError } from '../portable-execution-errors.js';
import { rehydrateMeasureFilter } from './protocol-rehydrate-filters.js';
import { UNSUPPORTED_CONTRACT_REASONS } from './unsupported-contract-reasons.js';
import type { DatasetQueryCalculation, DatasetQueryLimitBy, DatasetQueryOtherBucket } from './query-calculation-types.js';

/** A protocol value whose identifiers are branded strings, as plain JSON. */
function plain<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function portableCalculationFields(operation: ProtocolDatasetQuery): {
  calculations?: DatasetQueryCalculation[];
  limitBy?: DatasetQueryLimitBy;
  other?: DatasetQueryOtherBucket;
} {
  const calculations = operation.calculations?.map((entry, index) => {
    if (!('filter' in entry)) return plain<DatasetQueryCalculation>(entry);
    return {
      name: String(entry.name),
      filter: {
        measure: String(entry.filter.measure),
        where: entry.filter.where.map((expression, at) => rehydrateMeasureFilter(
          expression,
          () => new PortableExecutionUnsupportedError(
            `Calculation ${index} condition ${at} is not a field/operator/value comparison, so it cannot be planned.`,
            { reason: UNSUPPORTED_CONTRACT_REASONS.queryFilterNotComparison },
          ),
        )),
      },
    };
  });
  return {
    ...(calculations === undefined || calculations.length === 0 ? {} : { calculations }),
    ...(operation.limitBy === undefined ? {} : { limitBy: plain<DatasetQueryLimitBy>(operation.limitBy) }),
    ...(operation.other === undefined ? {} : { other: plain<DatasetQueryOtherBucket>(operation.other) }),
  };
}
