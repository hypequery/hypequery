import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { MCPServerConfig } from './executor.js';
import type { HypequeryMCPProtocolServer } from './protocol-server.js';
import { HypequeryMCPServer } from './server.js';

/** Connect an existing Hypequery MCP server to the stdio transport. */
export async function connectMCPServerStdio(
  server: HypequeryMCPProtocolServer,
): Promise<void> {
  await server.connect(new StdioServerTransport());

  // MCP stdio owns stdout, so lifecycle logging must use stderr.
  console.error('Hypequery MCP Server started');
}

/** Create and start the backwards-compatible stdio MCP server. */
export async function startStdioMCPServer(
  config: MCPServerConfig,
): Promise<HypequeryMCPServer> {
  const server = new HypequeryMCPServer(config);
  await connectMCPServerStdio(server);
  return server;
}
