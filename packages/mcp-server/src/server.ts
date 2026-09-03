/**
 * Backwards-compatible Hypequery MCP server facade.
 *
 * New integrations can compose HypequeryMCPExecutor with
 * HypequeryMCPProtocolServer and supply their own transport. Existing callers
 * can continue to construct this class and call start() for stdio.
 */

import { HypequeryMCPExecutor, type MCPServerConfig } from './executor.js';
import { HypequeryMCPProtocolServer } from './protocol-server.js';

export type { MCPServerConfig } from './executor.js';

export class HypequeryMCPServer extends HypequeryMCPProtocolServer {
  constructor(config: MCPServerConfig) {
    const executor = new HypequeryMCPExecutor(config);
    super({
      executor,
      name: config.name,
      version: config.version,
    });
  }

  /**
   * Start with the legacy stdio transport.
   *
   * @deprecated Prefer connect(transport) or startStdioMCPServer(config).
   */
  async start(): Promise<void> {
    const { connectMCPServerStdio } = await import('./stdio.js');
    await connectMCPServerStdio(this);
  }
}

/**
 * Create and start a backwards-compatible stdio MCP server.
 *
 * @deprecated Prefer createMCPExecutor with createMCPProtocolServer, or
 * startStdioMCPServer for an explicit stdio lifecycle.
 */
export async function createMCPServer(config: MCPServerConfig): Promise<HypequeryMCPServer> {
  const server = new HypequeryMCPServer(config);
  await server.start();
  return server;
}
