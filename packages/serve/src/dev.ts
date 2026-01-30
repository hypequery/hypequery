import type { AddressInfo } from "net";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer } from "http";
import { once } from "node:events";
import { homedir } from "os";
import { join } from "path";

import { createNodeHandler } from "./adapters/node.js";
import type { ServeBuilder, ServeHandler, StartServerOptions } from "./types.js";
import {
  createStore,
  DevQueryLogger,
  createDevHandler,
  isDevUIAvailable,
  type QueryHistoryStore,
  type DevHandler
} from "./dev-ui/index.js";

export interface ServeDevOptions extends StartServerOptions {
  /** Custom logger function */
  logger?: (message: string) => void;
  /** Path to SQLite database file (defaults to ~/.hypequery/dev-queries.db) */
  dbPath?: string;
  /** Disable the dev UI */
  disableDevUI?: boolean;
}

const defaultLogger = (message: string) => {
  console.log(message);
};

/**
 * Get the default database path for query history.
 */
function getDefaultDbPath(): string {
  return join(homedir(), '.hypequery', 'dev-queries.db');
}

/**
 * Create an enhanced Node.js HTTP handler that integrates dev UI with the original handler.
 */
function createEnhancedNodeHandler(
  originalHandler: ServeHandler,
  devHandler: DevHandler
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  // Wrap the original handler using the same utility as startNodeServer
  const nodeHandler = createNodeHandler(originalHandler);

  return async (req: IncomingMessage, res: ServerResponse) => {
    // Try dev handler first for /__dev/* routes
    if (await devHandler.handleRequest(req, res)) {
      return;
    }

    // Use the standard node handler for API routes
    await nodeHandler(req, res);
  };
}

/**
 * Start a development server with enhanced features:
 * - Query history storage (SQLite with memory fallback)
 * - Real-time SSE updates
 * - Dev UI at /__dev
 * - Query playground
 *
 * @example
 * ```typescript
 * import { serveDev } from '@hypequery/serve';
 *
 * const api = defineServe({ queries: { ... } });
 *
 * // Start dev server with all features
 * const server = await serveDev(api, { port: 4000 });
 *
 * // Dev UI available at http://localhost:4000/__dev
 * // API docs at http://localhost:4000/docs
 * ```
 */
export const serveDev = async <
  TQueries extends Record<string, any>,
  TAuth extends Record<string, unknown>
>(
  api: ServeBuilder<TQueries, TAuth>,
  options: ServeDevOptions = {}
) => {
  const port = options.port ?? Number(process.env.PORT ?? 4000);
  const hostname = options.hostname ?? "localhost";
  const logger = options.logger ?? defaultLogger;
  const dbPath = options.dbPath ?? getDefaultDbPath();
  const disableDevUI = options.disableDevUI ?? false;

  let store: QueryHistoryStore | null = null;
  let queryLogger: DevQueryLogger | null = null;
  let devHandler: DevHandler | null = null;

  // Initialize dev UI components if not disabled
  if (!disableDevUI) {
    try {
      // Initialize storage
      store = await createStore({ dbPath });

      // Initialize query logger — subscribes to the serve-layer query logger
      // so all endpoint executions are captured (regardless of backend)
      queryLogger = new DevQueryLogger(store, {
        batchSize: 10,
        flushInterval: 1000
      });
      queryLogger.initialize(api.queryLogger);

      // Create dev handler with API integration
      devHandler = createDevHandler({
        store,
        logger: queryLogger,
        api: {
          endpoints: Object.fromEntries(
            Object.entries(api.queries).map(([key, endpoint]) => [
              key,
              {
                key,
                path: endpoint.metadata?.path ?? `/${key}`,
                method: endpoint.metadata?.method ?? endpoint.method ?? 'GET',
                description: endpoint.metadata?.description,
                tags: endpoint.metadata?.tags ?? [],
                inputSchema: endpoint.inputSchema,
                outputSchema: endpoint.outputSchema
              }
            ])
          ),
          execute: async (key: string, opts: { input?: unknown }) => {
            return api.execute(key as keyof TQueries, { input: opts.input as any });
          }
        }
      });

      // Subscribe to query log events for SSE broadcasting
      queryLogger.onEvent((event) => {
        devHandler?.getRouter().getSSEHandler().broadcastQueryEvent(event);
      });
    } catch (error) {
      logger(`[DevUI] Failed to initialize: ${(error as Error).message}`);
      // Continue without dev UI
    }
  }

  // Create handler - enhanced with dev UI or just standard node handler
  const handler = devHandler
    ? createEnhancedNodeHandler(api.handler, devHandler)
    : createNodeHandler(api.handler);

  // Create and start server
  const server = createServer(handler);

  const onAbort = () => {
    server.close();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      server.close();
      throw new Error("Start signal already aborted");
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
  }

  server.listen(port, hostname);
  await once(server, "listening");

  // Stop function with cleanup
  const stop = async () => {
    // Shutdown dev handler (closes SSE connections)
    devHandler?.shutdown();

    // Shutdown query logger (flushes remaining logs)
    await queryLogger?.shutdown();

    // Close storage
    await store?.close();

    // Close server
    return new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  if (!options.quiet) {
    const address = server.address() as AddressInfo | string | null;
    const display =
      typeof address === "object" && address
        ? `${address.address}:${address.port}`
        : `${hostname}:${port}`;

    logger(`hypequery dev server running at http://${display}`);
    logger(`Docs available at http://${display}/docs`);

    if (devHandler) {
      logger(`Dev Tools at http://${display}/__dev`);

      if (!isDevUIAvailable()) {
        logger(`  (UI not built - run: pnpm --filter @hypequery/serve-ui build)`);
      }
    }
  }

  return {
    server,
    stop,
    /** Query history store (if initialized) */
    store,
    /** Query logger (if initialized) */
    queryLogger,
    /** Dev handler (if initialized) */
    devHandler
  };
};
