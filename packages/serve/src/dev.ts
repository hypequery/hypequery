import type { AddressInfo } from "net";

import { startNodeServer } from "./adapters/node.js";
import type { CacheObservability } from "./cache-observability.js";
import type {
  ServeBuilder,
  StartServerOptions,
  ToolkitDescription,
} from "./types.js";
import { formatQueryEvent, type ServeQueryLogger } from "./query-logger.js";

export type { CacheObservability, CacheLayerStats } from "./cache-observability.js";

/**
 * The narrow surface of a serve API that dev tooling (e.g.
 * `@hypequery/playground`) is allowed to depend on. `ServeBuilder`
 * satisfies this structurally — dev tools should accept this type
 * rather than reaching into serve internals.
 */
export interface DevIntegrationApi {
  /** Subscribe to endpoint execution events. */
  readonly queryLogger: ServeQueryLogger;
  /** Full endpoint registry, including semantic dataset/metric routes. */
  describe(): ToolkitDescription;
  /** In-process execution of a registered endpoint. */
  execute(key: string, options?: { input?: unknown }): Promise<unknown>;
  /**
   * Per-layer cache stats/clear (semantic + query-builder layers). Gateways
   * should advertise clear affordances (the `cache:clear` capability) only
   * for layers reporting `clearSupported`.
   */
  readonly cacheObservability: CacheObservability;
  /** Base path applied to all registered routes. */
  readonly basePath?: string;
}

export interface ServeDevOptions extends StartServerOptions {
  logger?: (message: string) => void;
}

const defaultLogger = (message: string) => {
  console.log(message);
};

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

  api.queryLogger.on((event) => {
    const line = formatQueryEvent(event);
    if (line) logger(line);
  });

  const server = await startNodeServer(api.handler, {
    ...options,
    hostname,
    port,
    quiet: true,
  });

  if (!options.quiet) {
    const address = server.server.address() as AddressInfo | string | null;
    const display =
      typeof address === "object" && address
        ? `${address.address}:${address.port}`
        : `${hostname}:${port}`;
    logger(`hypequery dev server running at http://${display}`);
    logger(`Docs available at http://${display}/docs`);
    if (options.mount) {
      logger(`Dev mount handler active at http://${display}`);
    }
  }

  return server;
};
