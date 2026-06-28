/**
 * Query Metric Tool
 *
 * Executes a metric query with optional dimensions, filters, grain, and sorting.
 */

import type { DatasetClient, MetricQuery } from '@hypequery/datasets';
import type { DatasetRegistry, MCPToolResponse, QueryResultResponse, QueryToolOptions } from '../types.js';
import { parseToolArgs, queryMetricArgsSchema, toMetricFilters } from './args.js';

export async function queryMetricTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown,
  options: QueryToolOptions = {},
): Promise<MCPToolResponse> {
  const validatedArgs = parseToolArgs(queryMetricArgsSchema, 'query_metric', args);
  const { dataset: datasetName, metric: metricName, dimensions, filters, grain, orderBy, limit, offset } = validatedArgs;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  if (!metricName) {
    throw new Error('metric parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  // Get the metric from the dataset
  const metric = (dataset as any)[metricName] || (dataset as any).metrics?.[metricName];

  if (!metric) {
    throw new Error(`Metric not found: ${metricName} in dataset ${datasetName}`);
  }

  // Build the query with proper types
  const query: MetricQuery = {
    dimensions: dimensions || [],
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

  // Execute the query
  const result = await analytics.execute(metric, query, {
    runtime: {
      tenant: options.tenantId ? { id: options.tenantId } : undefined,
    },
  });

  // Format the response with proper types
  const response: QueryResultResponse = {
    data: result.data,
    meta: {
      ...(options.includeSql ? { sql: result.meta?.sql } : {}),
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
