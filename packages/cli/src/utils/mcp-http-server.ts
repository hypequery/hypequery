/**
 * `hypequery mcp --http`: serve MCP over Streamable HTTP on this machine or a
 * private network, instead of stdio.
 */

import type { MCPHttpAuthenticator, MCPHttpHandlerOptions, MCPToolExecutor } from '@hypequery/mcp';
import { runMcpUntilSignal } from './mcp-lifecycle.js';

/** The key MCP clients send to a server started with `--http`. Distinct from the backend key. */
export const MCP_SERVER_KEY_VARIABLE = 'HYPEQUERY_MCP_KEY';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1']);
const DEFAULT_PORT = 3333;

export interface McpHttpOptions {
  /** Serve over Streamable HTTP instead of stdio. */
  http?: boolean;
  port?: string;
  host?: string;
  /** Comma-separated Host names the server answers. */
  allowedHosts?: string;
  /** Comma-separated browser origins allowed to call. */
  allowedOrigins?: string;
  /** OAuth resource URL: the audience tokens must carry. */
  resource?: string;
  /** Comma-separated authorization server issuer URLs. */
  authorizationServers?: string;
  /** Comma-separated scopes every caller must hold. */
  requiredScopes?: string;
}

export interface McpHttpSettings {
  port: number;
  host: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  oauth?: NonNullable<MCPHttpHandlerOptions['oauth']>;
  staticKey?: string;
}

/** Thrown for a flag combination that cannot be served; the CLI prints it as-is. */
export class McpHttpUsageError extends Error {
  constructor(message: string, readonly hints: readonly string[] = []) {
    super(message);
  }
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

/** Validate the `--http` flags and pick the static key from the environment. */
export function mcpHttpSettings(
  options: McpHttpOptions,
  env: Readonly<Record<string, string | undefined>>,
): McpHttpSettings {
  const port = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new McpHttpUsageError('--port must be a port number.');
  }
  const host = options.host ?? '127.0.0.1';
  const oauthFlags = [options.resource, options.authorizationServers, options.requiredScopes].filter(value => value !== undefined);
  if (oauthFlags.length > 0 && (!options.resource || list(options.authorizationServers).length === 0)) {
    throw new McpHttpUsageError('OAuth needs both --resource and --authorization-servers.', [
      'hypequery mcp --http --resource https://mcp.example.com/mcp --authorization-servers https://auth.example.com',
    ]);
  }
  const oauth = options.resource
    ? {
      resource: options.resource,
      authorizationServers: list(options.authorizationServers),
      ...(options.requiredScopes ? { requiredScopes: list(options.requiredScopes), scopesSupported: list(options.requiredScopes) } : {}),
    }
    : undefined;

  let allowedHosts = list(options.allowedHosts);
  if (allowedHosts.length === 0) {
    if (oauth) {
      allowedHosts = [new URL(oauth.resource).hostname, ...LOOPBACK_HOSTS];
    } else if (LOOPBACK_BINDS.has(host)) {
      allowedHosts = LOOPBACK_HOSTS;
    } else {
      throw new McpHttpUsageError(`--host ${host} accepts network traffic, so name the hosts it answers with --allowed-hosts.`, [
        'Checking Host protects against DNS rebinding.',
        `hypequery mcp --http --host ${host} --allowed-hosts mcp.internal.example.com`,
      ]);
    }
  }

  const staticKey = env[MCP_SERVER_KEY_VARIABLE]?.trim() || undefined;
  if (staticKey && oauth) {
    throw new McpHttpUsageError(`${MCP_SERVER_KEY_VARIABLE} and OAuth are alternatives; unset one.`);
  }
  return { port, host, allowedHosts, allowedOrigins: list(options.allowedOrigins), oauth, staticKey };
}

type HttpServerPackage = Pick<typeof import('@hypequery/mcp'),
  'createMCPHttpHandler' | 'listenMCPHttpServer' | 'createMCPStaticKeyAuthenticator' | 'createMCPServeAuthenticator'
  | 'MCPHttpAuthError' | 'createMCPExecutor'>;

/** The installed peer, checked for the HTTP transport before anything is loaded. */
export function httpServerPackage(module: unknown): HttpServerPackage {
  const candidate = module as Partial<HttpServerPackage> | null;
  if (!candidate || typeof candidate.createMCPHttpHandler !== 'function' || typeof candidate.listenMCPHttpServer !== 'function') {
    throw new McpHttpUsageError('The installed @hypequery/mcp has no HTTP transport.', ['npm install @hypequery/mcp@latest']);
  }
  return candidate as HttpServerPackage;
}

export interface RunMcpHttpServerInput {
  mcp: HttpServerPackage;
  settings: McpHttpSettings;
  authenticate: MCPHttpAuthenticator;
  createExecutor: MCPHttpHandlerOptions['createExecutor'];
  instrument: (executor: MCPToolExecutor) => MCPToolExecutor;
  /** One stderr line saying what is served, printed once listening. */
  describe: string;
  onStarted?: () => void;
}

/** Listen until SIGINT or SIGTERM, then close every session. */
export async function runMcpHttpServer(input: RunMcpHttpServerInput): Promise<void> {
  const { mcp, settings } = input;
  await runMcpUntilSignal(async () => {
    const handler = mcp.createMCPHttpHandler({
      authenticate: input.authenticate,
      createExecutor: async (principal, signal) => input.instrument(await input.createExecutor(principal, signal)),
      allowedHosts: settings.allowedHosts,
      allowedOrigins: settings.allowedOrigins,
      ...(settings.oauth ? { oauth: settings.oauth } : {}),
    });
    let listener: Awaited<ReturnType<HttpServerPackage['listenMCPHttpServer']>>;
    try {
      listener = await mcp.listenMCPHttpServer(handler, { port: settings.port, host: settings.host });
    } catch (error) {
      await handler.close();
      throw error;
    }
    input.onStarted?.();
    process.stderr.write(`${input.describe}\n`);
    process.stderr.write(`hypequery MCP listening on ${listener.url}/mcp (Host: ${settings.allowedHosts.join(', ')})\n`);
    if (settings.oauth) {
      process.stderr.write(`OAuth metadata: ${new URL(settings.oauth.resource).origin}/.well-known/oauth-protected-resource${new URL(settings.oauth.resource).pathname.replace(/\/$/, '')}\n`);
    }
    return listener;
  });
}
