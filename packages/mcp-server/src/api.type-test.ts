import { expectTypeOf, it } from 'vitest';
import {
  HypequeryMCPExecutor,
  HypequeryMCPProtocolServer,
  HypequeryMCPServer,
  MCPToolError,
  connectMCPServerStdio,
  createMCPExecutor,
  createMCPProtocolServer,
  createMCPServer,
  startStdioMCPServer,
  type MCPExecutorConfig,
  type MCPProtocolServerOptions,
  type MCPServerConfig,
  type MCPToolExecutor,
  type MCPToolErrorCode,
} from './index.js';

it('exports the transport-neutral and backwards-compatible MCP APIs', () => {
  expectTypeOf(HypequeryMCPExecutor).toBeConstructibleWith({} as MCPExecutorConfig);
  expectTypeOf(HypequeryMCPProtocolServer).toBeConstructibleWith({} as MCPProtocolServerOptions);
  expectTypeOf(HypequeryMCPServer).toBeConstructibleWith({} as MCPServerConfig);
  expectTypeOf(createMCPExecutor).returns.toMatchTypeOf<MCPToolExecutor>();
  expectTypeOf(createMCPProtocolServer).returns.toMatchTypeOf<HypequeryMCPProtocolServer>();
  expectTypeOf(connectMCPServerStdio).returns.toMatchTypeOf<Promise<void>>();
  expectTypeOf(startStdioMCPServer).returns.toMatchTypeOf<Promise<HypequeryMCPServer>>();
  expectTypeOf(createMCPServer).returns.toMatchTypeOf<Promise<HypequeryMCPServer>>();
  expectTypeOf(new MCPToolError('MCP_UNAUTHORIZED', 'Forbidden').code)
    .toMatchTypeOf<MCPToolErrorCode>();
});
