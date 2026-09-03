import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPToolExecutor } from './executor.js';
import { MCP_PACKAGE_VERSION } from './version.js';

export interface MCPProtocolServerOptions {
  executor: MCPToolExecutor;
  name?: string;
  version?: string;
}

/**
 * MCP protocol adapter for a transport-neutral Hypequery executor.
 *
 * The caller owns the transport. The same server can therefore be connected to
 * stdio, an in-memory pair, or a hosted transport without changing tool logic.
 */
export class HypequeryMCPProtocolServer {
  private readonly server: Server;
  protected readonly executor: MCPToolExecutor;

  constructor(options: MCPProtocolServerOptions) {
    this.executor = options.executor;
    this.server = new Server(
      {
        name: options.name ?? 'hypequery-mcp-server',
        version: options.version ?? MCP_PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      },
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => (
      this.executor.listTools()
    ));

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => (
      this.executor.callTool(request.params.name, request.params.arguments, extra?.signal)
    ));

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => (
      this.executor.listPrompts()
    ));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => (
      this.executor.getPrompt(request.params.name, request.params.arguments)
    ));
  }

  getManifestHash(): string {
    return this.executor.getManifestHash();
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  /** Alias retained for the existing Hypequery MCP server lifecycle. */
  async stop(): Promise<void> {
    await this.close();
  }
}

export function createMCPProtocolServer(
  options: MCPProtocolServerOptions,
): HypequeryMCPProtocolServer {
  return new HypequeryMCPProtocolServer(options);
}
