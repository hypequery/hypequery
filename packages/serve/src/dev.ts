import type { AddressInfo } from "net";

import { startNodeServer } from "./adapters/node.js";
import type { ServeBuilder, StartServerOptions } from "./types.js";
import type { ServeQueryEvent } from "./query-logger.js";

export interface ServeDevOptions extends StartServerOptions {
  logger?: (message: string) => void;
}

const defaultLogger = (message: string) => {
  console.log(message);
};

function formatQueryEvent(event: ServeQueryEvent): string | null {
  if (event.status === 'started') return null;

  const status = event.status === 'completed' ? '✓' : '✗';
  const duration = event.durationMs != null ? `${event.durationMs}ms` : '?';
  const code = event.responseStatus ?? (event.status === 'error' ? 500 : 200);

  let line = `  ${status} ${event.method} ${event.path} → ${code} (${duration})`;
  if (event.status === 'error' && event.error) {
    line += ` — ${event.error.message}`;
  }
  return line;
}

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

  const unsubscribe = api.queryLogger.on((event) => {
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
  }

  return server;
};
