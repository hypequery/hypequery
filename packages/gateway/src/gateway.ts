import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DevIntegrationApi, GatewayCapability } from './types.js';
import { createStore, type StorageOptions } from './storage/index.js';
import { DevQueryLogger } from './query-logger.js';
import { DevHandler } from './dev-handler.js';

export interface CreateGatewayOptions {
  /** Storage configuration for query history. */
  storage?: StorageOptions;
  /** Project name surfaced via /meta. */
  projectName?: string;
  /**
   * Cross-origin allowlist for /__dev/*. Empty by default (same-origin only).
   */
  allowedOrigins?: string[];
  /**
   * Bearer token required for non-loopback requests to /__dev/*. When unset,
   * only loopback clients may reach the gateway. Browser users can bootstrap
   * an HttpOnly dev session by opening `/__dev?token=<devToken>`.
   */
  devToken?: string;
}

export interface Gateway {
  /** Node mount handler for `serveDev({ mount })`. */
  mount(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Capabilities advertised by this gateway. */
  capabilities: GatewayCapability[];
  /** Whether the studio UI is installed and being served. */
  uiAvailable: boolean;
  /** Flush storage, close SSE connections, and detach from serve events. */
  shutdown(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  return addr != null && LOOPBACK.has(addr);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return undefined;
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/**
 * Create a local hypequery gateway over a serve API. Implements gateway
 * contract v0 (plans/gateway-contract.md) and serves the studio UI same-origin
 * at /__dev. Returns a mount handler for `serveDev({ mount })`.
 */
export async function createGateway(
  api: DevIntegrationApi,
  options: CreateGatewayOptions = {}
): Promise<Gateway> {
  const store = await createStore(options.storage ?? {});

  // Build endpoint metadata for history enrichment from the serve registry.
  const description = api.describe();
  const endpointMetadata = Object.fromEntries(
    description.queries.map((q) => [q.key, { description: q.description ?? q.summary, path: q.path }])
  );

  const logger = new DevQueryLogger(store, { endpointMetadata });
  logger.initialize(api.queryLogger);

  // `cache` is always available: per-layer stats from serve's observability,
  // or history-derived approximations as fallback. `cache:clear` is the
  // sub-capability the UI checks before rendering clear affordances —
  // advertised only when a wired layer reports clearSupported. By gateway
  // creation time the serve API is fully built, so this snapshot is accurate.
  const capabilities: GatewayCapability[] = ['registry', 'execute', 'history', 'events', 'cache'];
  const cacheLayers = await api.cacheObservability.getStats();
  if (cacheLayers.some((layer) => layer.clearSupported)) capabilities.push('cache:clear');

  const handler = new DevHandler({
    store,
    logger,
    cacheObservability: api.cacheObservability,
    api,
    capabilities,
    projectName: options.projectName,
    allowedOrigins: options.allowedOrigins
  });

  // Stream persisted query events to connected SSE clients.
  logger.onEvent((event) => handler.getSSEHandler().broadcastQueryEvent(event));

  const devToken = options.devToken;
  const browserSession = devToken ? randomBytes(32).toString('base64url') : undefined;

  const mount = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url || '';
    if (url !== '/__dev' && !url.startsWith('/__dev/') && !url.startsWith('/__dev?')) {
      return false;
    }

    // Security guard: non-loopback clients require a matching bearer token or
    // a browser session established from the token at the UI shell.
    if (!isLoopback(req)) {
      if (!devToken) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: dev gateway is restricted to localhost' }));
        return true;
      }

      // Preflight carries no credentials. The router still restricts CORS to
      // the explicit origin allowlist before a browser sends the real request.
      if (req.method === 'OPTIONS') return handler.handleRequest(req, res);

      const requestUrl = new URL(url, 'http://hypequery.local');
      const isShell = requestUrl.pathname === '/__dev' || requestUrl.pathname === '/__dev/';
      const bootstrapToken = isShell && req.method === 'GET' ? requestUrl.searchParams.get('token') : null;
      if (bootstrapToken && secureEqual(bootstrapToken, devToken) && browserSession) {
        res.writeHead(303, {
          Location: '/__dev',
          'Set-Cookie': `hq_dev_session=${browserSession}; Path=/__dev; HttpOnly; SameSite=Strict`,
          'Cache-Control': 'no-store'
        });
        res.end();
        return true;
      }

      const bearerAuthorized = secureEqual(bearerToken(req), devToken);
      const sessionAuthorized =
        browserSession !== undefined && secureEqual(cookieValue(req, 'hq_dev_session'), browserSession);
      if (!bearerAuthorized && !sessionAuthorized) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: valid dev gateway credentials required' }));
        return true;
      }
    }

    return handler.handleRequest(req, res);
  };

  return {
    mount,
    capabilities,
    uiAvailable: handler.uiAvailable,
    async shutdown() {
      await logger.shutdown();
      handler.shutdown();
      await store.close();
    }
  };
}
