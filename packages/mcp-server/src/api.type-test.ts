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

it('exports the self-hosted HTTP transport and its authenticators', async () => {
  const {
    createMCPHttpHandler,
    createMCPStaticKeyAuthenticator,
    createMCPServeAuthenticator,
    listenMCPHttpServer,
    createMCPNodeRequestListener,
    MCPHttpAuthError,
  } = await import('./index.js');
  type Options = import('./index.js').MCPHttpHandlerOptions;
  type Principal = import('./index.js').MCPPrincipal;
  type Handler = import('./index.js').MCPHttpHandler;

  expectTypeOf(createMCPHttpHandler).parameter(0).toEqualTypeOf<Options>();
  expectTypeOf(createMCPHttpHandler).returns.toEqualTypeOf<Handler>();
  expectTypeOf<Handler['handle']>().toEqualTypeOf<(request: Request) => Promise<Response>>();
  expectTypeOf<Options['createExecutor']>().parameter(0).toEqualTypeOf<Principal>();
  expectTypeOf<Principal['tenantId']>().toEqualTypeOf<string | undefined>();
  expectTypeOf(createMCPStaticKeyAuthenticator).returns.toEqualTypeOf<import('./index.js').MCPHttpAuthenticator>();
  expectTypeOf(createMCPServeAuthenticator).returns.toEqualTypeOf<import('./index.js').MCPHttpAuthenticator>();
  expectTypeOf(listenMCPHttpServer).returns.toEqualTypeOf<Promise<import('./index.js').MCPHttpListener>>();
  expectTypeOf(createMCPNodeRequestListener).parameter(0).toEqualTypeOf<Handler>();
  expectTypeOf(new MCPHttpAuthError('invalid_token').code).toEqualTypeOf<import('./index.js').MCPHttpAuthErrorCode>();

  // A serve auth strategy with a custom auth context plugs in with its own tenant extraction.
  type AppAuth = { userId?: string; orgId: string; [key: string]: unknown };
  createMCPServeAuthenticator<AppAuth>({
    strategies: async () => ({ userId: 'u', orgId: 'o' }),
    tenant: { extract: auth => auth.orgId },
  });
  // @ts-expect-error the OAuth resource is required when oauth is configured.
  const _missing: Options['oauth'] = { authorizationServers: ['https://auth.example.test'] };
});
