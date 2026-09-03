import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CanonicalSemanticQuerySchemas,
  DatasetClient,
} from '@hypequery/datasets';
import { MCPToolError } from './errors.js';
import { datasetGuidePrompt } from './prompts/dataset-guide.js';
import { getDatasetSchemaTool } from './tools/introspect.js';
import { listDatasetsTool } from './tools/list-datasets.js';
import { queryDatasetTool } from './tools/query-dataset.js';
import { queryMetricTool } from './tools/query-metric.js';
import { buildMCPToolManifest } from './tools/tool-manifest.js';
import { buildMCPQuerySchemas } from './tools/utils/canonical-query-schemas.js';
import {
  assertWithinBudget,
  resolveExecutionBudget,
  type EffectiveExecutionBudget,
} from './tools/utils/execution-budget.js';
import { resolveQueryLimits } from './tools/utils/query-limits.js';
import type { DatasetRegistry, MCPExecutionBudget, MCPQueryLimits } from './types.js';
import { validateMCPServerTenantConfig } from './utils/tenant-config.js';
import {
  createMCPErrorResponse,
  createMCPResultTooLargeResponse,
} from './tools/utils/tool-response.js';

export interface MCPExecutorConfig {
  /** Dataset registry - map of dataset names to instances. */
  datasets: DatasetRegistry;
  /** Semantic analytics client for running metric and dataset queries. */
  analytics: DatasetClient;
  /** Trusted tenant id used to scope tenant-keyed datasets. */
  tenantId?: string;
  /** Include generated SQL in trusted-debug responses. Defaults to false. */
  includeSql?: boolean;
  /** Server-side query ceilings applied in addition to Dataset limits. */
  queryLimits?: MCPQueryLimits;
  /** Query deadline and serialized-result byte ceilings. */
  executionBudget?: MCPExecutionBudget;
}

export interface MCPServerConfig extends MCPExecutorConfig {
  /** Server name shown to MCP clients. */
  name?: string;
  /** Server version shown to MCP clients. */
  version?: string;
}

export interface MCPToolExecutor {
  listTools(): Promise<ListToolsResult>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>;
  listPrompts(): Promise<ListPromptsResult>;
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
  getManifestHash(): string;
}

/**
 * Transport-neutral Hypequery MCP tool and prompt executor.
 *
 * This class owns semantic discovery and execution, but has no network or stdio
 * lifecycle. It can be called directly or injected into any MCP transport
 * adapter.
 */
export class HypequeryMCPExecutor implements MCPToolExecutor {
  private readonly querySchemas: CanonicalSemanticQuerySchemas;
  private readonly executionBudget: EffectiveExecutionBudget;

  constructor(private readonly config: MCPExecutorConfig) {
    validateMCPServerTenantConfig(config);
    resolveQueryLimits(undefined, config.queryLimits);
    this.executionBudget = resolveExecutionBudget(config.executionBudget);
    this.querySchemas = buildMCPQuerySchemas(config.datasets ?? {}, config.queryLimits);
  }

  getManifestHash(): string {
    return this.querySchemas.manifestHash;
  }

  async listTools(): Promise<ListToolsResult> {
    return buildMCPToolManifest(this.querySchemas);
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'list_datasets':
          return await listDatasetsTool(this.config.datasets);

        case 'get_dataset_schema':
          return await getDatasetSchemaTool(
            this.config.datasets,
            args,
            { includeSql: this.config.includeSql },
          );

        case 'query_metric':
          return await queryMetricTool(
            this.config.datasets,
            this.config.analytics,
            args,
            {
              tenantId: this.config.tenantId,
              includeSql: this.config.includeSql,
              limits: this.config.queryLimits,
              executionBudget: this.config.executionBudget,
              signal,
              inputSchema: this.querySchemas.queryMetric,
            },
          );

        case 'query_dataset':
          return await queryDatasetTool(
            this.config.datasets,
            this.config.analytics,
            args,
            {
              tenantId: this.config.tenantId,
              includeSql: this.config.includeSql,
              limits: this.config.queryLimits,
              executionBudget: this.config.executionBudget,
              signal,
              inputSchema: this.querySchemas.queryDataset,
            },
          );

        default:
          throw new MCPToolError('MCP_UNKNOWN_TOOL', `Unknown tool: ${name}`);
      }
    } catch (error) {
      const response = createMCPErrorResponse(error);
      try {
        assertWithinBudget(response, this.executionBudget);
        return response;
      } catch {
        return createMCPResultTooLargeResponse();
      }
    }
  }

  async listPrompts(): Promise<ListPromptsResult> {
    return {
      prompts: [
        {
          name: 'dataset_guide',
          description: 'Guide for querying datasets with natural language',
          arguments: [
            {
              name: 'dataset',
              description: 'Name of the dataset to get guidance for',
              required: false,
            },
          ],
        },
      ],
    };
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    if (name === 'dataset_guide') {
      return datasetGuidePrompt(this.config.datasets, args?.dataset);
    }

    throw new Error(`Unknown prompt: ${name}`);
  }
}

export function createMCPExecutor(config: MCPExecutorConfig): HypequeryMCPExecutor {
  return new HypequeryMCPExecutor(config);
}
