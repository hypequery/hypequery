import type {
  AuthContext,
  ServeBuilder,
  ServeConfig,
  ServeEndpointMap,
  ServeSemanticEndpointMap,
  ServeQueriesMap,
  StartServerOptions,
  MetricsConfig,
  DatasetsConfig,
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
 * import { createAPI, startServer } from '@hypequery/serve';
 * const api = createAPI({ queries: { ... } });
 * startServer(api, { port: 3000 });
 * ```
 */
export const defineServe = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = Record<never, never>,
  TMetrics extends MetricsConfig<TAuth> = Record<never, never>,
  TDatasets extends DatasetsConfig<TAuth> = Record<never, never>
>(
  config: ServeConfig<TContext, TAuth, TQueries, TMetrics, TDatasets>
): ServeBuilder<
  ServeEndpointMap<TQueries, TContext, TAuth>
    & ServeSemanticEndpointMap<TMetrics, TDatasets, TContext, TAuth>,
  TContext,
  TAuth
> => {
  const api = createAPI<TContext, TAuth, TQueries, TMetrics, TDatasets>(config);

  const loadNodeAdapter = async () => {
    if (typeof require !== "undefined") {
      return require("../adapters/node.js");
    }
    return import("../adapters/node.js");
  };

  // Extend the API with backwards-compatible ServeBuilder methods
  const builder = api as unknown as ServeBuilder<
    ServeEndpointMap<TQueries, TContext, TAuth>
      & ServeSemanticEndpointMap<TMetrics, TDatasets, TContext, TAuth>,
    TContext,
    TAuth
  >;
  const routeConfig: Record<string, { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" }> = {};

  for (const [key, endpoint] of Object.entries(api.queries)) {
    routeConfig[key] = { method: endpoint.method };
  }

  Object.defineProperty(builder, "basePath", {
    value: config.basePath ?? "/api/analytics",
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(builder, "_routeConfig", {
    value: routeConfig,
    enumerable: true,
    configurable: true,
  });

  const originalRoute = builder.route.bind(builder);
  (builder as any).route = (path: string, endpoint: any, options: any = {}) => {
    const result = originalRoute(path, endpoint, options);
    const queryKey = Object.entries(api.queries).find(([_, entry]) => entry === endpoint)?.[0];
    if (queryKey) {
      routeConfig[queryKey] = { method: options?.method ?? endpoint.method };
    }
    return result;
  };

  // Add transport method that ServeBuilder expects
  (builder as any).start = async (options: StartServerOptions = {}) => {
    const { startNodeServer } = await loadNodeAdapter();
    return startNodeServer(api.handler, options);
  };

  return builder;
};
