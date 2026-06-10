/**
 * Query Metric Tool
 *
 * Executes a metric query with optional dimensions, filters, grain, and sorting.
 */

import type { SemanticExecutor, MetricQuery, MetricRef, GrainedMetricRef } from '@hypequery/datasets';
import type { DatasetRegistry, MCPToolResponse, QueryResultResponse, MAX_QUERY_LIMIT } from '../types.js';
import { resolveDataset, textResponse } from './dataset-access.js';
import { parseQueryMetricArgs } from './args.js';

export async function queryMetricTool(
  datasets: DatasetRegistry,
  executor: SemanticExecutor,
  args: unknown
): Promise<MCPToolResponse> {
  const { dataset: datasetName, metric: metricName, dimensions, filters, grain, orderBy, limit } = parseQueryMetricArgs(args);

  if (!metricName) {
    throw new Error('metric parameter is required');
  }

  const dataset = resolveDataset(datasets, datasetName);

  // Metrics may be attached as a top-level property or under `metrics`.
  const metric = dataset[metricName] || dataset.metrics?.[metricName];

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

  // Execute the query. The metric is read from a loosely-typed registry, so
  // narrow it to the executor's expected handle at this single boundary.
  const result = await executor.metric(metric as MetricRef | GrainedMetricRef, query, {
    runtime: {
      builderFactory: executor.getBuilderFactory(),
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
