import type {
  FetchHandler,
  HypeQueryAPI,
  ServeHandler,
  StartServerOptions,
  ServeStartResult,
} from "../types.js";
import { createNodeHandler, startNodeServer } from "./node.js";
import { createFetchHandler } from "./fetch.js";

type HandlerSource = HypeQueryAPI<any, any, any> | { handler: ServeHandler };

const extractHandler = (source: HandlerSource): ServeHandler => {
  return source.handler;
};

/**
 * Start a standalone HTTP server from a HypeQueryAPI.
 *
 * @example
 * ```ts
 * const api = createAPI({ queries: { ... } });
 * const { stop } = await serve(api, { port: 3000 });
 * ```
 */
export const serve = async (
  api: HandlerSource,
  options?: StartServerOptions,
): Promise<ServeStartResult> => {
  return startNodeServer(extractHandler(api), options);
};

/**
 * Create a Node.js HTTP handler (req, res) from a HypeQueryAPI.
 *
 * @example
 * ```ts
 * const api = createAPI({ queries: { ... } });
 * app.use('/analytics', toNodeHandler(api));
 * ```
 */
export const toNodeHandler = (api: HandlerSource) => {
  return createNodeHandler(extractHandler(api));
};

/**
 * Create a Fetch API handler from a HypeQueryAPI.
 * Works with Cloudflare Workers, Deno, Bun, Vercel Edge, etc.
 *
 * @example
 * ```ts
 * const api = createAPI({ queries: { ... } });
 * export default toFetchHandler(api);
 * ```
 */
export const toFetchHandler = (api: HandlerSource): FetchHandler => {
  return createFetchHandler(extractHandler(api));
};
