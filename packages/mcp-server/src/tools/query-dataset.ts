/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and measures.
 */

import type { DatasetClient, DatasetQuery } from '@hypequery/datasets';
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

export async function queryDatasetTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown,
  options: QueryToolOptions = {},
): Promise<MCPToolResponse> {
  const inputSchema = options.inputSchema ?? buildMCPQuerySchemas(datasets, options.limits).queryDataset;
  const validatedArgs = parseToolArgs(inputSchema, 'query_dataset', args);
  const { dataset: datasetName, dimensions, measures, filters, grain, orderBy } = validatedArgs;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  if (!dimensions?.length && !measures?.length) {
    throw new Error('At least one dimension or measure must be specified');
  }

  const pagination = applyQueryLimits(dataset, validatedArgs, options.limits);
  const executionBudget = resolveExecutionBudget(options.executionBudget);

  // Build the query with proper types
  const query: DatasetQuery = {
    dimensions: dimensions || [],
    measures: measures || [],
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

  const result = await executeWithinBudget(
    signal => analytics.execute(dataset as any, query, {
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
