import { buildClientContractQuerySchemas, type ClientContractQuerySchemas } from '@hypequery/datasets/schemas';
import { decodeProtocolClientContract, ProtocolClientContractError, validateProtocolClientQuery, type ClientQueryPlan, type ProtocolClientContract } from '@hypequery/protocol';
import type { CallToolResult, GetPromptResult, ListPromptsResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { MCPToolExecutor } from './executor.js';
import { MCPToolError } from './errors.js';
import type { MCPCatalogBudget, MCPExecutionBudget, MCPQueryLimits } from './types.js';
import { assertWithinBudget, executeWithinBudget, resolveExecutionBudget, type EffectiveExecutionBudget } from './tools/utils/execution-budget.js';
import { resolveQueryLimits } from './tools/utils/query-limits.js';
import { assertManifestWithinBudget, resolveCatalogBudget } from './tools/utils/catalog-budget.js';
import { createMCPErrorResponse, createMCPResultTooLargeResponse, createMCPToolResponse } from './tools/utils/tool-response.js';
import { backendRequest, backendText, backendUrl, discardBackendBody, type BackendHeaders, type HttpBackend } from './utils/http-client/transport.js';
import { httpToolArguments } from './utils/http-client/arguments.js';
import { mcpClientProfile } from './utils/http-client/profile.js';
import { clientHttpResult } from './utils/http-client/result.js';
import { clientHttpManifest } from './utils/http-client/manifest.js';
import { clientDatasetList, clientDatasetNames, clientDatasetProfile } from './utils/http-client/discovery.js';

export interface MCPHttpExecutorConfig {
  /** Full authorized discovery URL. Backend origin and credentials are host configuration. */
  url: string;
  /** One principal's credentials; a resolver may rotate credentials for that same principal. */
  headers?: BackendHeaders;
  fetchFn?: typeof fetch;
  queryLimits?: MCPQueryLimits;
  executionBudget?: MCPExecutionBudget;
  catalogBudget?: MCPCatalogBudget;
  /** Whole discovery response ceiling, default 256 KiB, hard maximum 1 MiB. */
  maxContractBytes?: number;
}

/** Execute client tools through an authorized HTTP backend; Python retains SQL/auth/tenant ownership. */
export class HypequeryMCPHttpExecutor implements MCPToolExecutor {
  private readonly schemas: ClientContractQuerySchemas;
  private readonly manifest: ListToolsResult;
  private invalidated = false;

  private constructor(
    private readonly backend: HttpBackend,
    private readonly authorizedHash: string,
    private readonly budget: EffectiveExecutionBudget,
    private readonly contractBytes: number,
    contract: ProtocolClientContract,
    config: MCPHttpExecutorConfig,
  ) {
    this.schemas = buildClientContractQuerySchemas(mcpClientProfile(contract, config.queryLimits));
    this.manifest = assertManifestWithinBudget(clientHttpManifest(this.schemas, authorizedHash), resolveCatalogBudget(config.catalogBudget));
  }

  static async create(config: MCPHttpExecutorConfig, signal?: AbortSignal): Promise<HypequeryMCPHttpExecutor> {
    const backend: HttpBackend = { discovery: backendUrl(config.url), headers: config.headers, fetchFn: config.fetchFn ?? fetch };
    const configuredBudget = resolveExecutionBudget(config.executionBudget);
    const budget = Object.freeze({ ...configuredBudget, maxResponseBytes: Math.min(configuredBudget.maxResponseBytes, 1_048_576) });
    const maximum = config.maxContractBytes ?? 262_144;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576) throw new Error('maxContractBytes must be an integer between 1 and 1048576.');
    // Validate all host limits before making a request.
    resolveCatalogBudget(config.catalogBudget);
    resolveQueryLimits(undefined, config.queryLimits);
    return executeWithinBudget(async requestSignal => {
      const response = await backendRequest(backend, backend.discovery, requestSignal);
      HypequeryMCPHttpExecutor.requireSuccess(response);
      const contract = HypequeryMCPHttpExecutor.decodeContract(await backendText(response, maximum, requestSignal));
      return new HypequeryMCPHttpExecutor(backend, contract.contentHash, budget, maximum, contract, config);
    }, budget, signal);
  }

  private static decodeContract(text: string): ProtocolClientContract {
    try {
      const contract = decodeProtocolClientContract(text);
      if (contract.view !== 'authorized') throw new Error();
      return contract;
    } catch { throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend returned an invalid authorized client contract.', { retryable: false }); }
  }

  private static requireSuccess(response: Response): void {
    if (response.status === 200) return;
    discardBackendBody(response);
    if (response.status === 401 || response.status === 403) throw new MCPToolError('MCP_UNAUTHORIZED', 'Backend access denied.');
    if (response.status === 409) throw new MCPToolError('MCP_STALE_CONTRACT', 'Backend client contract changed; reconnect.', { retryable: false });
    throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend request was refused.', { retryable: response.status === 429 || response.status >= 500 });
  }

  private assertActive(): void {
    if (this.invalidated) throw new MCPToolError('MCP_STALE_CONTRACT', 'Backend client contract changed; reconnect.', { retryable: false });
  }

  private async current(signal: AbortSignal): Promise<void> {
    this.assertActive();
    const response = await backendRequest(this.backend, this.backend.discovery, signal);
    try { HypequeryMCPHttpExecutor.requireSuccess(response); }
    catch (error) { if (response.status === 409) this.invalidated = true; throw error; }
    const contract = HypequeryMCPHttpExecutor.decodeContract(await backendText(response, this.contractBytes, signal));
    if (contract.contentHash !== this.authorizedHash) {
      this.invalidated = true;
      this.assertActive();
    }
    this.assertActive();
  }

  getManifestHash(): string { return this.schemas.manifestHash; }

  async listTools(signal?: AbortSignal): Promise<ListToolsResult> {
    await executeWithinBudget(requestSignal => this.current(requestSignal), this.budget, signal);
    return structuredClone(this.manifest);
  }

  private plan(name: string, args: unknown): ClientQueryPlan {
    const input = httpToolArguments(args, ['dataset', 'metric', 'dimensions', 'measures', 'filters', 'having', 'grain', 'timezone', 'orderBy', 'limit', 'offset', 'includeMeta']);
    const endpoint = this.schemas.contract.endpoints.find(item => name === 'query_dataset'
      ? item.kind === 'dataset' && item.id === input.dataset
      : item.kind === 'metric' && item.dataset === input.dataset && item.id === input.metric);
    if (!endpoint) throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'Invalid client query target.');
    try {
      return validateProtocolClientQuery(this.schemas.contract, endpoint.id, input, 'mcp');
    } catch (error) {
      // The pointer names a contract member or an index, never a submitted value.
      const path = error instanceof ProtocolClientContractError ? error.path : '';
      throw new MCPToolError('MCP_INVALID_ARGUMENTS', path ? `Invalid client query at ${path}.` : 'Invalid client query.');
    }
  }

  async callTool(name: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    try {
      this.assertActive();
      let plan: ClientQueryPlan | undefined;
      let dataset: string | undefined;
      if (name === 'query_dataset' || name === 'query_metric') plan = this.plan(name, args);
      else if (name === 'list_datasets') httpToolArguments(args, []);
      else if (name === 'get_dataset_schema') {
        const input = httpToolArguments(args, ['dataset']);
        if (typeof input.dataset !== 'string' || !clientDatasetNames(this.schemas.contract).includes(input.dataset)) throw new MCPToolError('MCP_NOT_FOUND', 'Dataset group not found.');
        dataset = input.dataset;
      } else throw new MCPToolError('MCP_UNKNOWN_TOOL', 'Unknown client tool.');
      return await executeWithinBudget(async requestSignal => {
        await this.current(requestSignal);
        let value: Record<string, unknown>;
        if (plan) {
          const url = new URL(plan.endpoint.path, this.backend.discovery.origin);
          const response = await backendRequest(this.backend, url, requestSignal, plan.body, plan.endpoint.schemaHash);
          try { HypequeryMCPHttpExecutor.requireSuccess(response); }
          catch (error) { if (response.status === 409) this.invalidated = true; throw error; }
          value = clientHttpResult(await backendText(response, this.budget.maxResponseBytes, requestSignal), plan);
        } else value = dataset === undefined ? clientDatasetList(this.schemas.contract) : clientDatasetProfile(this.schemas.contract, dataset);
        const result = createMCPToolResponse(value);
        assertWithinBudget(result, this.budget);
        return result;
      }, this.budget, signal);
    } catch (error) {
      const result = createMCPErrorResponse(error);
      try { assertWithinBudget(result, this.budget); return result; }
      catch { return createMCPResultTooLargeResponse(); }
    }
  }

  async listPrompts(signal?: AbortSignal): Promise<ListPromptsResult> {
    await executeWithinBudget(requestSignal => this.current(requestSignal), this.budget, signal);
    return { prompts: [{ name: 'dataset_guide', description: 'Guide to the authorized client endpoint profiles', arguments: [{ name: 'dataset', required: false }] }] };
  }

  async getPrompt(name: string, args?: Record<string, string>, signal?: AbortSignal): Promise<GetPromptResult> {
    const input = httpToolArguments(args, ['dataset']);
    if (name !== 'dataset_guide' || input.dataset !== undefined && (typeof input.dataset !== 'string' || !clientDatasetNames(this.schemas.contract).includes(input.dataset))) throw new MCPToolError('MCP_NOT_FOUND', 'Client guide not found.');
    await executeWithinBudget(requestSignal => this.current(requestSignal), this.budget, signal);
    const profiles = input.dataset === undefined ? clientDatasetList(this.schemas.contract) : clientDatasetProfile(this.schemas.contract, input.dataset as string);
    const result: GetPromptResult = { messages: [{ role: 'user', content: { type: 'text', text: 'Use only the authorized endpoints and tool schemas. A metric-only dataset group is not a query_dataset target. Each endpoint retains its own fields, defaults and limits. For pagination, request includeMeta=true when metadata is available and follow pagination.hasMore and offset + limit. Tenant and credentials belong to the backend host. Reconnect explicitly after a stale-contract error.\n' + JSON.stringify(profiles) } }] };
    assertWithinBudget(result, this.budget);
    return result;
  }
}

export function createMCPHttpExecutor(config: MCPHttpExecutorConfig, signal?: AbortSignal): Promise<HypequeryMCPHttpExecutor> {
  return HypequeryMCPHttpExecutor.create(config, signal);
}
