/**
 * Discovery without execution.
 *
 * A hosted gateway lists tools for one principal against one activated
 * deployment, and does that before — and independently of — being able to run
 * anything. `HypequeryMCPExecutor` cannot serve that: it requires a
 * `DatasetClient` it would never call, and refuses to construct at all when a
 * dataset is tenant-scoped and no fixed `tenantId` is configured. Both are
 * correct for a local server, where one process serves one tenant and every
 * listed tool is runnable. Neither holds for a gateway, which resolves a tenant
 * per request through the deployment data plane.
 *
 * The alternative would be a second manifest generator in the gateway, which
 * `CORE-03` exists to prevent: the tool schemas an agent is given and the
 * validators a query is checked against have to come from one catalog.
 *
 * So this shares the schema compiler and the catalog tools, and refuses the two
 * tools that need a query engine. Listing a tool it will not run is deliberate:
 * the manifest a client caches must be the one it will keep seeing once
 * execution is wired in behind it, or every client re-lists on the day that
 * lands.
 */

import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { CanonicalSemanticQuerySchemas } from '@hypequery/datasets';
import { MCPToolError } from './errors.js';
import type { MCPToolExecutor } from './executor.js';
import { datasetGuidePrompt } from './prompts/dataset-guide.js';
import { getDatasetSchemaTool } from './tools/introspect.js';
import { listDatasetsTool } from './tools/list-datasets.js';
import { buildMCPToolManifest } from './tools/tool-manifest.js';
import { buildMCPQuerySchemas } from './tools/utils/canonical-query-schemas.js';
import {
  assertManifestWithinBudget,
  resolveCatalogBudget,
  type EffectiveCatalogBudget,
} from './tools/utils/catalog-budget.js';
import { createMCPErrorResponse } from './tools/utils/tool-response.js';
import type { DatasetRegistry, MCPCatalogBudget, MCPQueryLimits } from './types.js';

/**
 * Provenance a client needs to cache a manifest and know when it went stale.
 *
 * Namespaced under `com.hypequery/` in the result's `_meta`, as the MCP spec
 * requires of implementation-defined keys.
 */
export interface MCPToolManifestMeta {
  /** The immutable generation these tools were listed from. */
  readonly activationRevision?: string;
  /** Content-addressed identity of the contract behind them. */
  readonly deploymentIdentity?: string;
  /** How the tools were shaped — `catalog` for the fixed compatibility set. */
  readonly toolMode?: string;
}

export interface MCPDiscoveryExecutorConfig {
  /** Datasets to advertise. Already narrowed to what the caller may see. */
  datasets: DatasetRegistry;
  /**
   * Datasets offered as a `query_dataset` target. Defaults to all of them.
   *
   * A deployment authorizes a dataset and each of its metrics through separate
   * endpoint policies, so a caller can be entitled to a metric on a dataset it
   * may not query directly. Such a dataset still belongs in `datasets` — its
   * metrics are reachable, and it may be joined to — but naming it here would
   * advertise a target execution refuses.
   */
  queryableDatasets?: readonly string[];
  /** Server-side query ceilings, so advertised schemas match what will run. */
  queryLimits?: MCPQueryLimits;
  /**
   * Tool-count and manifest-byte ceilings.
   *
   * This is where they bite. A gateway lists one manifest per authorized
   * catalog, and a large deployment's `query_dataset` schema names every
   * dataset, dimension, measure, and filter field it published. Exceeding the
   * budget raises `MCPCatalogBudgetError`, which a caller is expected to catch
   * and answer by choosing a narrower tool mode.
   */
  catalogBudget?: MCPCatalogBudget;
  /** Attached to `listTools`, so a client can pin what it listed. */
  meta?: MCPToolManifestMeta;
}

const NOT_EXECUTABLE =
  'This endpoint lists datasets and metrics but does not execute queries.';

function metaEntries(meta: MCPToolManifestMeta | undefined): Record<string, string> | undefined {
  if (meta === undefined) return undefined;
  const entries = Object.entries({
    'com.hypequery/activationRevision': meta.activationRevision,
    'com.hypequery/deploymentIdentity': meta.deploymentIdentity,
    'com.hypequery/toolMode': meta.toolMode,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/**
 * A read-only executor over a catalog.
 *
 * `list_datasets`, `get_dataset_schema`, and the prompts read the agent-safe
 * catalog and need no query engine, so they answer normally. `query_dataset`
 * and `query_metric` are advertised with their exact schemas and refuse.
 */
export class HypequeryMCPDiscoveryExecutor implements MCPToolExecutor {
  private readonly querySchemas: CanonicalSemanticQuerySchemas;
  private readonly catalogBudget: EffectiveCatalogBudget;
  private readonly meta: Record<string, string> | undefined;

  constructor(private readonly config: MCPDiscoveryExecutorConfig) {
    // Deliberately no tenant assertion. A gateway has no fixed tenant to
    // declare, and none is needed: nothing here reaches a table.
    this.querySchemas = buildMCPQuerySchemas(
      config.datasets ?? {},
      config.queryLimits,
      config.queryableDatasets,
    );
    this.catalogBudget = resolveCatalogBudget(config.catalogBudget);
    this.meta = metaEntries(config.meta);
  }

  /** The catalog these tools were compiled from, for caching by content. */
  getManifestHash(): string {
    return this.querySchemas.manifestHash;
  }

  async listTools(): Promise<ListToolsResult> {
    // Budgeted before `_meta` is attached, so the ceiling measures the catalog
    // rather than the provenance a gateway chose to stamp on it.
    const manifest = assertManifestWithinBudget(
      buildMCPToolManifest(this.querySchemas),
      this.catalogBudget,
    );
    return this.meta === undefined ? manifest : { ...manifest, _meta: this.meta };
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'list_datasets':
          return await listDatasetsTool(this.config.datasets);

        case 'get_dataset_schema':
          return await getDatasetSchemaTool(this.config.datasets, args);

        case 'query_dataset':
        case 'query_metric':
          // Not `MCP_UNKNOWN_TOOL`: the tool exists and is listed, and telling a
          // client it does not would invite it to stop asking for good.
          throw new MCPToolError('MCP_EXECUTION_FAILED', NOT_EXECUTABLE, {
            retryable: false,
          });

        default:
          throw new MCPToolError('MCP_UNKNOWN_TOOL', `Unknown tool: ${name}`);
      }
    } catch (error) {
      return createMCPErrorResponse(error);
    }
  }

  async listPrompts(): Promise<ListPromptsResult> {
    return {
      prompts: [{
        name: 'dataset_guide',
        description: 'Guide for querying datasets with natural language',
        arguments: [{
          name: 'dataset',
          description: 'Name of the dataset to get guidance for',
          required: false,
        }],
      }],
    };
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    if (name === 'dataset_guide') {
      return datasetGuidePrompt(this.config.datasets, args?.dataset);
    }
    throw new Error(`Unknown prompt: ${name}`);
  }
}

export function createMCPDiscoveryExecutor(
  config: MCPDiscoveryExecutorConfig,
): MCPToolExecutor {
  return new HypequeryMCPDiscoveryExecutor(config);
}
