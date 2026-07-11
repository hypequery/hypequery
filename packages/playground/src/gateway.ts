import type { IncomingMessage, ServerResponse } from 'http';
import type { DevIntegrationApi, GatewayCapability } from './types.js';
import { createStore, type StorageOptions } from './storage/index.js';
import { DevQueryLogger } from './query-logger.js';
import { DevHandler } from './dev-handler.js';
import { Telemetry, anonymize, durationBucket } from './telemetry.js';

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
   * only loopback clients may reach the gateway.
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

  const telemetry = new Telemetry({ projectDir: process.cwd() });
  await telemetry.initialize();

  const handler = new DevHandler({
    store,
    logger,
    cacheObservability: api.cacheObservability,
    api,
    capabilities,
    projectName: options.projectName,
    allowedOrigins: options.allowedOrigins,
    telemetry
  });

  // Stream persisted query events to connected SSE clients.
  logger.onEvent((event) => handler.getSSEHandler().broadcastQueryEvent(event));

  // Funnel step 1: the dev server + gateway came up.
  telemetry.track('gateway_started', {
    capabilities: capabilities.join(','),
    uiAvailable: handler.uiAvailable,
    endpointCount: description.queries.length
  });

  // Aggregate query activity from the serve layer (names hashed, no SQL).
  logger.onEvent((event) => {
    if (event.type === 'query:completed' || event.type === 'query:error') {
      // endpointKey is set by DevQueryLogger at runtime but not surfaced in
      // the QueryLog type; read it defensively.
      const endpointKey = (event.data as { endpointKey?: string }).endpointKey;
      telemetry.track('endpoint_executed', {
        ok: event.type === 'query:completed',
        endpointHash: endpointKey ? anonymize(endpointKey) : 'unknown',
        durationBucket: durationBucket(event.data.duration ?? 0)
      });
    }
  });

  const devToken = options.devToken;

  const mount = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url || '';
    if (url !== '/__dev' && !url.startsWith('/__dev/') && !url.startsWith('/__dev?')) {
      return false;
    }

    // Security guard: non-loopback clients require a matching dev token.
    if (!isLoopback(req)) {
      if (!devToken || bearerToken(req) !== devToken) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: dev gateway is restricted to localhost' }));
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
      await telemetry.shutdown();
      await store.close();
    }
  };
}
