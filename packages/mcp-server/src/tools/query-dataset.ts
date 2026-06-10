/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and metrics.
 */

import type { SemanticExecutor, DatasetQuery, DatasetInstance } from '@hypequery/datasets';
import type { DatasetRegistry, QueryDatasetArgs, MCPToolResponse, QueryResultResponse, MAX_QUERY_LIMIT } from '../types.js';
import { resolveDataset, textResponse } from './dataset-access.js';

export async function queryDatasetTool(
  datasets: DatasetRegistry,
  executor: SemanticExecutor,
  args: unknown
): Promise<MCPToolResponse> {
  const { dataset: datasetName, dimensions, metrics, filters, grain, orderBy, limit } = (args ?? {}) as QueryDatasetArgs;

  const dataset = resolveDataset(datasets, datasetName);

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

  // The registry is loosely typed; narrow to the executor's dataset instance
  // shape at this single boundary.
  const result = await executor.dataset(dataset as unknown as DatasetInstance, query, {
    runtime: {
      tenant: undefined,
    },
  });

  // Format the response with proper types
  const response: QueryResultResponse = {
    data: result.data,
    meta: {
      sql: result.meta?.sql,
      timingMs: result.meta?.timingMs,
      rowCount: result.data.length,
    },
  };

  return textResponse(response);
}
