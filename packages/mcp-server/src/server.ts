/**
 * MCP Server for Hypequery Semantic Layer
 *
 * Exposes datasets and metrics via Model Context Protocol (MCP)
 * for use with Claude Desktop, Cursor, and other MCP-compatible tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { DatasetClient } from '@hypequery/datasets';
import { listDatasetsTool } from './tools/list-datasets.js';
import { getDatasetSchemaTool } from './tools/introspect.js';
import { queryMetricTool } from './tools/query-metric.js';
import { queryDatasetTool } from './tools/query-dataset.js';
import { datasetGuidePrompt } from './prompts/dataset-guide.js';
import type { DatasetRegistry } from './types.js';

export interface MCPServerConfig {
  /**
   * Dataset registry - map of dataset names to instances
   */
  datasets: DatasetRegistry;

  /**
   * Semantic analytics for running metric and dataset queries
   */
  analytics: DatasetClient;

  /**
   * Server name (shown in MCP client)
   */
  name?: string;

  /**
   * Server version
   */
  version?: string;
}

export class HypequeryMCPServer {
  private server: Server;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;

    this.server = new Server(
      {
        name: config.name ?? 'hypequery-mcp-server',
        version: config.version ?? '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_datasets',
          description: 'List all available datasets in the semantic layer',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_dataset_schema',
          description: 'Get the schema (dimensions, metrics, relationships) for a specific dataset',
          inputSchema: {
            type: 'object',
            properties: {
              dataset: {
                type: 'string',
                description: 'Name of the dataset to introspect',
              },
            },
            required: ['dataset'],
          },
        },
        {
          name: 'query_metric',
          description: 'Execute a metric query with optional dimensions, filters, time grain, and sorting',
          inputSchema: {
            type: 'object',
            properties: {
              dataset: {
                type: 'string',
                description: 'Name of the dataset containing the metric',
              },
              metric: {
                type: 'string',
                description: 'Name of the metric to query',
              },
              dimensions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Dimensions to group by (optional)',
              },
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    operator: {
                      type: 'string',
                      enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like']
                    },
                    value: {},
                  },
                  required: ['field', 'operator', 'value'],
                },
                description: 'Filters to apply (optional)',
              },
              grain: {
                type: 'string',
                enum: ['day', 'week', 'month', 'quarter', 'year'],
                description: 'Time grain for time-series queries (optional)',
              },
              orderBy: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                  },
                  required: ['field', 'direction'],
                },
                description: 'Sort order (optional)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of rows to return (optional)',
              },
            },
            required: ['dataset', 'metric'],
          },
        },
        {
          name: 'query_dataset',
          description: 'Execute an ad-hoc dataset query with custom dimensions and metrics',
          inputSchema: {
            type: 'object',
            properties: {
              dataset: {
                type: 'string',
                description: 'Name of the dataset to query',
              },
              dimensions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Dimensions to select',
              },
              metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Metrics to calculate',
              },
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    operator: {
                      type: 'string',
                      enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like']
                    },
                    value: {},
                  },
                  required: ['field', 'operator', 'value'],
                },
                description: 'Filters to apply (optional)',
              },
              grain: {
                type: 'string',
                enum: ['day', 'week', 'month', 'quarter', 'year'],
                description: 'Time grain for time-series queries (optional)',
              },
              orderBy: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                  },
                  required: ['field', 'direction'],
                },
                description: 'Sort order (optional)',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of rows to return (optional)',
              },
            },
            required: ['dataset'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_datasets':
            return await listDatasetsTool(this.config.datasets);

          case 'get_dataset_schema':
            return await getDatasetSchemaTool(this.config.datasets, args);

          case 'query_metric':
            return await queryMetricTool(
              this.config.datasets,
              this.config.analytics,
              args
            );

          case 'query_dataset':
            return await queryDatasetTool(
              this.config.datasets,
              this.config.analytics,
              args
            );

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
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
    }));

    // Get prompt content
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'dataset_guide') {
        return datasetGuidePrompt(this.config.datasets, args?.dataset);
      }

      throw new Error(`Unknown prompt: ${name}`);
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log to stderr (stdout is used for MCP protocol)
    console.error('Hypequery MCP Server started');
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    await this.server.close();
  }
}

/**
 * Create and start an MCP server
 */
export async function createMCPServer(config: MCPServerConfig): Promise<HypequeryMCPServer> {
  const server = new HypequeryMCPServer(config);
  await server.start();
  return server;
}
