/**
 * Query Metric Tool
 *
 * Executes a metric query with optional dimensions, filters, grain, and sorting.
 */

import type { DatasetClient, MetricQuery } from '@hypequery/datasets';
import { MCPToolError } from '../errors.js';
import type { DatasetRegistry, MCPToolResponse, QueryToolOptions } from '../types.js';
import { parseToolArgs, toMetricFilters } from './args.js';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { applyQueryLimits } from './utils/query-limits.js';
import {
  assertWithinBudget,
  executeWithinBudget,
  resolveExecutionBudget,
} from './utils/execution-budget.js';
import { buildMCPQueryResult } from './utils/query-result.js';
import { createMCPToolResponse } from './utils/tool-response.js';

export async function queryMetricTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown,
  options: QueryToolOptions = {},
): Promise<MCPToolResponse> {
  const inputSchema = options.inputSchema ?? buildMCPQuerySchemas(datasets, options.limits).queryMetric;
  const validatedArgs = parseToolArgs(inputSchema, 'query_metric', args);
  const { dataset: datasetName, metric: metricName, dimensions, filters, grain, orderBy } = validatedArgs;

  if (!datasetName) {
    throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'dataset parameter is required');
  }

  if (!metricName) {
    throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'metric parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new MCPToolError('MCP_NOT_FOUND', `Dataset not found: ${datasetName}`);
  }

  // Get the metric from the dataset
  const metric = (dataset as any)[metricName] || (dataset as any).metrics?.[metricName];

  if (!metric) {
    throw new MCPToolError(
      'MCP_NOT_FOUND',
      `Metric not found: ${metricName} in dataset ${datasetName}`,
    );
  }

  const pagination = applyQueryLimits(dataset, validatedArgs, options.limits);
  const executionBudget = resolveExecutionBudget(options.executionBudget);

  // Build the query with proper types
  const query: MetricQuery = {
    dimensions: dimensions || [],
    filters: toMetricFilters(filters),
    orderBy: orderBy || [],
    limit: pagination.limit,
  };

  if (grain) {
    query.by = grain;
  }

  if (pagination.offset !== undefined) {
    query.offset = pagination.offset;
  }

  // Execute the query
  const result = await executeWithinBudget(
    signal => analytics.execute(metric, query, {
      runtime: {
        tenant: options.tenantId ? { id: options.tenantId } : undefined,
      },
      abortSignal: signal,
      cache: false,
    }),
    executionBudget,
    options.signal,
  );

  // Format the response with proper types
  const response = buildMCPQueryResult(result, options.includeSql);
  const toolResponse = createMCPToolResponse(response);
  assertWithinBudget(toolResponse, executionBudget);
  return toolResponse;
}
