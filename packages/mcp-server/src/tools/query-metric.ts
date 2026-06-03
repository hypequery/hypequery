/**
 * Query Metric Tool
 *
 * Executes a metric query with optional dimensions, filters, grain, and sorting.
 */

import type { DatasetClient, MetricQuery } from '@hypequery/datasets';
import type { DatasetRegistry, QueryMetricArgs, MCPToolResponse, QueryResultResponse, MAX_QUERY_LIMIT } from '../types.js';

export async function queryMetricTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown
): Promise<MCPToolResponse> {
  // Parse and validate args
  const validatedArgs = args as QueryMetricArgs;
  const { dataset: datasetName, metric: metricName, dimensions, filters, grain, orderBy, limit } = validatedArgs;

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

  // Execute the query
  const result = await analytics.execute(metric, query, {
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

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
