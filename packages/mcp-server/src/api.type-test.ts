import { expectTypeOf, it } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';
import {
  HypequeryMCPExecutor,
  HypequeryMCPProtocolServer,
  HypequeryMCPServer,
  MCPToolError,
  connectMCPServerStdio,
  createMCPExecutor,
  createMCPHttpExecutor,
  HypequeryMCPHttpExecutor,
  type MCPHttpExecutorConfig,
  createMCPProtocolServer,
  createMCPServer,
  startStdioMCPServer,
  type MCPExecutorConfig,
  type MCPProtocolServerOptions,
  type MCPServerConfig,
  type MCPToolExecutor,
  type MCPToolErrorCode,
  type MCPErrorDetails,
  createMCPErrorResponse,
  mcpToolErrorFromSemanticFailure,
  type QueryDatasetArgs,
  type QueryMetricArgs,
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

it('exports hosted error details and the semantic failure mapping', () => {
  expectTypeOf<'MCP_RATE_LIMITED'>().toMatchTypeOf<MCPToolErrorCode>();
  expectTypeOf<MCPErrorDetails['retryAfterSeconds']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<MCPErrorDetails['relist']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<MCPErrorDetails['reason']>().toEqualTypeOf<string | undefined>();
  expectTypeOf(MCPToolError).toBeConstructibleWith('MCP_RATE_LIMITED', 'Slow down', {
    retryAfterSeconds: 7,
    reason: 'HOST_RATE_LIMITED',
  });
  expectTypeOf(mcpToolErrorFromSemanticFailure).returns.toEqualTypeOf<MCPToolError>();
  expectTypeOf(createMCPErrorResponse).parameter(0).toBeUnknown();
});

it('accepts segments in the exported query argument types', () => {
  expectTypeOf<QueryDatasetArgs['segments']>().toEqualTypeOf<string[] | undefined>();
  expectTypeOf<QueryMetricArgs['segments']>().toEqualTypeOf<string[] | undefined>();

  const _orders = dataset('orders', {
    source: 'orders',
    dimensions: { status: dimension.string() },
    measures: { revenue: measure.sum('amount') },
    segments: { paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] } },
  });
  expectTypeOf<QueryDatasetArgs<typeof _orders>['segments']>()
    .toEqualTypeOf<'paid'[] | undefined>();
  expectTypeOf<QueryMetricArgs<typeof _orders>['segments']>()
    .toEqualTypeOf<'paid'[] | undefined>();
  expectTypeOf<QueryDatasetArgs<typeof _orders>['dataset']>().toEqualTypeOf<'orders'>();
  expectTypeOf<QueryMetricArgs<typeof _orders>['dataset']>().toEqualTypeOf<'orders'>();
});


it('exports a governed HTTP executor without adding tenant or SQL configuration', () => {
  expectTypeOf(createMCPHttpExecutor).parameter(0).toEqualTypeOf<MCPHttpExecutorConfig>();
  expectTypeOf(createMCPHttpExecutor).returns.toEqualTypeOf<Promise<HypequeryMCPHttpExecutor>>();
  expectTypeOf<HypequeryMCPHttpExecutor>().toExtend<MCPToolExecutor>();
  const configuration: MCPHttpExecutorConfig = {
    url: 'https://python.example.test/client-contract',
    headers: async () => ({ authorization: 'Bearer fixture-token' }),
  };
  const invalidTenant: MCPHttpExecutorConfig = {
    url: configuration.url,
    // @ts-expect-error Tenant scope belongs to the Python backend principal.
    tenantId: 'not-a-client-option',
  };
  const invalidSql: MCPHttpExecutorConfig = {
    url: configuration.url,
    // @ts-expect-error HTTP client profiles never expose SQL diagnostics.
    includeSql: true,
  };
  void [configuration, invalidTenant, invalidSql];
});
