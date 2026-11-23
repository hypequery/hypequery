/**
 * Query Dataset Tool
 *
 * Executes an ad-hoc dataset query with custom dimensions and measures.
 */

import type { DatasetClient } from '@hypequery/datasets';
import { MCPToolError } from '../errors.js';
import type { DatasetRegistry, MCPToolResponse, QueryDatasetArgs, QueryToolOptions } from '../types.js';
import { parseToolArgs } from './args.js';
import { datasetQueryFromArgs } from './utils/dataset-query-args.js';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { applyQueryLimits } from './utils/query-limits.js';
import {
  assertWithinBudget,
  executeWithinBudget,
  resolveExecutionBudget,
} from './utils/execution-budget.js';
import { buildMCPQueryResult } from './utils/query-result.js';
import { createMCPToolResponse } from './utils/tool-response.js';
import { tenantFieldFilterError } from './utils/tenant-filter.js';
import { queryValidationError } from './utils/query-validation-error.js';

export async function queryDatasetTool(
  datasets: DatasetRegistry,
  analytics: DatasetClient,
  args: unknown,
  options: QueryToolOptions = {},
): Promise<MCPToolResponse> {
  const inputSchema = options.inputSchema ?? buildMCPQuerySchemas(datasets, options.limits).queryDataset;
  const validatedArgs = parseToolArgs<QueryDatasetArgs>(inputSchema, 'query_dataset', args);
  const { dataset: datasetName, dimensions, measures } = validatedArgs;

  if (!datasetName) {
    throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new MCPToolError('MCP_NOT_FOUND', `Dataset not found: ${datasetName}`);
  }

  if (!dimensions?.length && !measures?.length) {
    throw new MCPToolError(
      'MCP_INVALID_ARGUMENTS',
      'At least one dimension or measure must be specified',
    );
  }

  const pagination = applyQueryLimits(dataset, validatedArgs, options.limits);
  const executionBudget = resolveExecutionBudget(options.executionBudget);

  const query = datasetQueryFromArgs(validatedArgs, pagination);

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
  ).catch((error: unknown) => {
    throw tenantFieldFilterError(error, options.tenantId) ?? queryValidationError(error, 'query_dataset') ?? error;
  });

  // Format the response with proper types
  const response = buildMCPQueryResult(result, options.includeSql);
  const toolResponse = createMCPToolResponse(response);
  assertWithinBudget(toolResponse, executionBudget);
  return toolResponse;
}
