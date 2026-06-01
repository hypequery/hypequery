/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and metrics.
 */

import type { SemanticExecutor, DatasetQuery } from '@hypequery/datasets';
import type { DatasetRegistry, QueryDatasetArgs, MCPToolResponse, QueryResultResponse, MAX_QUERY_LIMIT } from '../types.js';

export async function queryDatasetTool(
  datasets: DatasetRegistry,
  executor: SemanticExecutor,
  args: unknown
): Promise<MCPToolResponse> {
  // Parse and validate args
  const validatedArgs = args as QueryDatasetArgs;
  const { dataset: datasetName, dimensions, metrics, filters, grain, orderBy, limit } = validatedArgs;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  if (!dimensions?.length && !metrics?.length) {
    throw new Error('At least one dimension or metric must be specified');
  }

  // Build the query with proper types
  const query: DatasetQuery = {
    dimensions: dimensions || [],
    measures: metrics || [],
    filters: filters || [],
    orderBy: orderBy || [],
  };

  if (grain) {
    query.by = grain;
  }

  // Apply limit with maximum cap
  const MAX_LIMIT: typeof MAX_QUERY_LIMIT = 10000;
  if (limit !== undefined) {
    query.limit = Math.min(limit, MAX_LIMIT);
  }

  const result = await executor.dataset(dataset as any, query);

  // Format the response with proper types
  const response: QueryResultResponse = {
    data: result.data,
    meta: {
      sql: result.meta?.sql,
      timingMs: result.meta?.timingMs,
      rowCount: result.data.length,
    },
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
