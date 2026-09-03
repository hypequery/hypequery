/** Agent-safe dataset discovery and separately authorized trusted debugging. */

import {
  projectAgentSafeCatalog,
  projectTrustedDebugCatalog,
  type AgentCatalogDataset,
  type DatasetCatalogSource,
  type TrustedDebugCatalogAuthorization,
} from '@hypequery/datasets';
import { MCPToolError } from '../errors.js';
import type {
  DatasetRegistry,
  GetDatasetSchemaArgs,
  MCPToolResponse,
  SchemaToolOptions,
} from '../types.js';
import { projectLegacyAgentDataset } from './utils/legacy-agent-catalog.js';
import { createMCPToolResponse } from './utils/tool-response.js';

function datasetNameFromArgs(args: unknown): string {
  const datasetName = args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Partial<GetDatasetSchemaArgs>).dataset
    : undefined;
  if (typeof datasetName !== 'string' || datasetName.length === 0) {
    throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'dataset parameter is required');
  }
  return datasetName;
}

function isDatasetInstance(value: unknown): value is DatasetCatalogSource {
  return !!value && typeof value === 'object' && (value as { __type?: unknown }).__type === 'dataset';
}

export async function getDatasetSchemaTool(
  datasets: DatasetRegistry,
  args: unknown,
  _options: SchemaToolOptions = {},
): Promise<MCPToolResponse> {
  const datasetName = datasetNameFromArgs(args);
  const dataset = datasets[datasetName];
  if (!dataset) {
    throw new MCPToolError('MCP_NOT_FOUND', `Dataset not found: ${datasetName}`);
  }

  const schema: AgentCatalogDataset = isDatasetInstance(dataset)
    ? projectAgentSafeCatalog({ [datasetName]: dataset }).datasets[0]
    : projectLegacyAgentDataset(datasetName, dataset as Record<string, unknown>);
  return createMCPToolResponse(schema);
}

/**
 * Physical catalog diagnostics for a caller that has already passed a
 * separate authorization check. This projection is intentionally not
 * registered as an agent-facing MCP tool.
 */
export async function getTrustedDatasetSchema(
  datasets: DatasetRegistry,
  args: unknown,
  authorization: TrustedDebugCatalogAuthorization,
): Promise<unknown> {
  const datasetName = datasetNameFromArgs(args);
  const dataset = datasets[datasetName];
  if (!dataset) {
    throw new MCPToolError('MCP_NOT_FOUND', `Dataset not found: ${datasetName}`);
  }
  if (!isDatasetInstance(dataset)) {
    throw new MCPToolError(
      'MCP_INVALID_ARGUMENTS',
      'Trusted debugging requires a canonical dataset instance',
    );
  }
  const debug = projectTrustedDebugCatalog({ [datasetName]: dataset }, authorization);
  return debug.kind === 'dataset-catalog' ? debug.datasets[datasetName] : debug;
}
