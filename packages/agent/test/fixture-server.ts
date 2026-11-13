/**
 * A tenant MCP endpoint in-process: `@hypequery/mcp`'s Streamable HTTP handler
 * on a real loopback socket, serving the tenant tool set (list_datasets,
 * get_dataset_schema, query_dataset) over a fixture dataset, with Cloud's
 * request id on results and a K-19 style error (hint, docsUrl, requestId).
 */
import {
  createMCPErrorResponse,
  createMCPExecutor,
  createMCPHttpHandler,
  listenMCPHttpServer,
  MCPHttpAuthError,
  MCPToolError,
  type MCPToolExecutor,
} from '@hypequery/mcp';

export const TENANT_TOOLS = ['list_datasets', 'get_dataset_schema', 'query_dataset'];
export const REQUEST_ID_META_KEY = 'com.hypequery/requestId';

export const ROWS = [
  { region: 'EU', revenue: 120 },
  { region: 'US', revenue: 340 },
];

export interface FixtureServer {
  /** The MCP endpoint URL. */
  url: string;
  /** Every `Authorization` header the endpoint received. */
  authorizations: string[];
  /** Tokens the endpoint accepts; add one to simulate a refreshed token. */
  validTokens: Set<string>;
  /** The executor every session gets: the tool list is the server's own. */
  executor: MCPToolExecutor;
  /** Number of sessions opened so far. */
  sessionsOpened: () => number;
  close(): Promise<void>;
}

export const THROTTLED = {
  code: 'MCP_RATE_LIMITED',
  message: 'Too many queries for this tenant',
  hint: 'Wait 30 seconds, then retry the same query.',
  docsUrl: 'https://hypequery.com/docs/errors/rate-limited',
  requestId: 'req_throttled',
} as const;

function fixtureExecutor(): MCPToolExecutor {
  const executor: MCPToolExecutor = createMCPExecutor({
    datasets: {
      orders: {
        description: 'Orders by region',
        dimensions: { region: {} },
        measures: { revenue: {} },
      },
    } as never,
    analytics: {
      execute: async () => ({ data: ROWS, meta: {} }),
    } as never,
  });
  let calls = 0;
  return {
    listTools: async (signal) => {
      const listed = await executor.listTools(signal);
      return { ...listed, tools: listed.tools.filter(tool => TENANT_TOOLS.includes(tool.name)) };
    },
    callTool: async (name, args, signal) => {
      calls += 1;
      if (name === 'query_dataset' && args?.dataset === 'throttled') {
        return createMCPErrorResponse(new MCPToolError('MCP_RATE_LIMITED', THROTTLED.message, {
          hint: THROTTLED.hint,
          docsUrl: THROTTLED.docsUrl,
          requestId: THROTTLED.requestId,
          retryAfterSeconds: 30,
        })) as never;
      }
      const result = await executor.callTool(name, args, signal);
      return { ...result, _meta: { [REQUEST_ID_META_KEY]: `req_${calls}` } };
    },
    listPrompts: signal => executor.listPrompts(signal),
    getPrompt: (name, args, signal) => executor.getPrompt(name, args, signal),
    getManifestHash: () => executor.getManifestHash(),
  };
}

export async function startFixtureServer(token = 'agent-token-0123456789'): Promise<FixtureServer> {
  const authorizations: string[] = [];
  const validTokens = new Set([token]);
  const executor = fixtureExecutor();
  let sessions = 0;
  const handler = createMCPHttpHandler({
    allowedHosts: ['127.0.0.1'],
    authenticate: (request) => {
      const header = request.headers.get('authorization');
      if (header === null) return null;
      authorizations.push(header);
      const bearer = header.replace(/^Bearer /, '');
      if (!validTokens.has(bearer)) throw new MCPHttpAuthError('invalid_token');
      return { subject: 'end-user-1', tenantId: 'northwind' };
    },
    createExecutor: () => {
      sessions += 1;
      return executor;
    },
  });
  const listener = await listenMCPHttpServer(handler, { port: 0 });
  return {
    url: `${listener.url}/mcp`,
    authorizations,
    validTokens,
    executor,
    sessionsOpened: () => sessions,
    close: () => listener.close(),
  };
}
