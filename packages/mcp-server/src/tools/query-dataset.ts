/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and measures.
 */

import type { DatasetClient, DatasetQuery } from '@hypequery/datasets';
import type { DatasetRegistry, MCPToolResponse, QueryResultResponse, QueryToolOptions } from '../types.js';
import { parseToolArgs, queryDatasetArgsSchema, toMetricFilters } from './args.js';

export async function queryDatasetTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown,
  options: QueryToolOptions = {},
): Promise<MCPToolResponse> {
  const validatedArgs = parseToolArgs(queryDatasetArgsSchema, 'query_dataset', args);
  const { dataset: datasetName, dimensions, measures, metrics, filters, grain, orderBy, limit, offset } = validatedArgs;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  if (measures?.length && metrics?.length) {
    throw new Error('Use measures or metrics, not both');
  }

  const selectedMeasures = measures ?? metrics;

  if (!dimensions?.length && !selectedMeasures?.length) {
    throw new Error('At least one dimension or measure must be specified');
  }

  // Build the query with proper types
  const query: DatasetQuery = {
    dimensions: dimensions || [],
    measures: selectedMeasures || [],
    filters: toMetricFilters(filters),
    orderBy: orderBy || [],
  };

  if (grain) {
    query.by = grain;
  }

  if (limit !== undefined) {
    query.limit = limit;
  }
  if (offset !== undefined) {
    query.offset = offset;
  }

  const result = await analytics.execute(dataset as any, query, {
    runtime: {
      tenant: options.tenantId ? { id: options.tenantId } : undefined,
    },
  });

  // Format the response with proper types
  const response: QueryResultResponse = {
    data: result.data,
    meta: {
      sql: result.meta?.sql,
      timingMs: result.meta?.timingMs,
      rowCount: result.data.length,
      ...(result.meta?.pagination ? { pagination: result.meta.pagination } : {}),
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
