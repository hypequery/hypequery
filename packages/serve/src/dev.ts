import type { AddressInfo } from "net";

import { startNodeServer } from "./adapters/node.js";
import type { ServeBuilder, StartServerOptions } from "./types.js";

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
