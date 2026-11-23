import type { DatasetQuery } from '@hypequery/datasets';
import type { QueryDatasetArgs } from '../../types.js';
import { toMetricFilters } from '../args.js';

/**
 * Validated `query_dataset` arguments as the dataset client query they ask
 * for. Every field the schema accepted is carried, so the client plans it or
 * refuses it, and none is dropped on the way. The MCP `grain` is the query's `by`.
 */
export function datasetQueryFromArgs(
  args: Omit<QueryDatasetArgs, 'dataset'>,
  pagination: { readonly limit: number; readonly offset?: number },
): DatasetQuery {
  const query: DatasetQuery = {
    dimensions: args.dimensions || [],
    measures: args.measures || [],
    filters: toMetricFilters(args.filters as Parameters<typeof toMetricFilters>[0]),
    orderBy: args.orderBy || [],
    limit: pagination.limit,
  };
  if (args.timezone !== undefined) query.timezone = args.timezone;
  if (args.grain) query.by = args.grain;
  if (args.segments?.length) query.segments = args.segments;
  if (args.having?.length) query.having = args.having;
  // RFC 0026 and 0029: the client plans these, and refuses any it cannot run.
  if (args.calculations?.length) query.calculations = args.calculations;
  if (args.limitBy !== undefined) query.limitBy = args.limitBy;
  if (args.other !== undefined) query.other = args.other;
  if (args.timeKey !== undefined) query.timeKey = args.timeKey;
  if (args.fill !== undefined) query.fill = args.fill;
  if (pagination.offset !== undefined) query.offset = pagination.offset;
  return query;
}
