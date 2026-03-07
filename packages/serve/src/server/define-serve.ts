import type {
  AuthContext,
  ServeBuilder,
  ServeConfig,
  ServeEndpointMap,
  ServeQueriesMap,
  StartServerOptions,
} from "../types.js";
import { createAPI } from "./create-api.js";

/**
 * Define and configure a serve API with embedded transport.
 *
 * @deprecated Prefer `createAPI()` with standalone transport functions for
 * better separation of concerns. `defineServe()` couples API definition
 * with the Node.js HTTP server via `.start()`.
 *
 * @example
 * ```ts
 * // Before (defineServe)
 * const api = defineServe({ queries: { ... } });
 * api.start({ port: 3000 });
 *
 * // After (createAPI + serve)
 * import { createAPI, serve } from '@hypequery/serve';
 * const api = createAPI({ queries: { ... } });
 * serve(api, { port: 3000 });
 * ```
 */
export const defineServe = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
>(
  config: ServeConfig<TContext, TAuth, TQueries>
): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
  const api = createAPI<TContext, TAuth, TQueries>(config);

  const loadNodeAdapter = async () => {
    if (typeof require !== "undefined") {
      return require("../adapters/node.js");
    }
    return import("../adapters/node.js");
  };

  // Extend the API with backwards-compatible ServeBuilder methods
  const builder = api as unknown as ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>;

  // Add transport method that ServeBuilder expects
  (builder as any).start = async (options: StartServerOptions = {}) => {
    const { startNodeServer } = await loadNodeAdapter();
    return startNodeServer(api.handler, options);
  };

  return builder;
};
