import type {
  AuthContext,
  AuthStrategy,
  HttpMethod,
  ServeBuilder,
  ServeEndpoint,
  ServeEndpointMap,
  ServeMiddleware,
  ServeRequest,
  ServeQueriesMap,
  ServeHandler,
  ExecuteQueryFunction,
  RouteRegistrationOptions,
  StartServerOptions,
} from "../types.js";
import type { ServeRouter } from "../router.js";
import { ServeQueryLogger } from "../query-logger.js";
import { mergeTags } from "../utils.js";
import { normalizeRoutePath } from "../router.js";
import { mapEndpointToToolkit } from "./mapper.js";

export const createBuilderMethods = <
  TQueries extends ServeQueriesMap<TContext, TAuth>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  queryEntries: ServeEndpointMap<TQueries, TContext, TAuth>,
  queryLogger: ServeQueryLogger,
  routeConfig: Record<string, { method: HttpMethod }>,
  router: ServeRouter,
  authStrategies: AuthStrategy<TAuth>[],
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[],
  executeQuery: ExecuteQueryFunction<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>,
  handler: ServeHandler,
  basePath: string,
): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
  const builder: ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> = {
    queries: queryEntries,
    queryLogger,
    _routeConfig: routeConfig,

    route: (path: string, endpoint: ServeEndpoint<any, any, TContext, TAuth>, options: Partial<RouteRegistrationOptions<TContext, TAuth>> = {}) => {
      if (!endpoint) {
        throw new Error("Endpoint definition is required when registering a route");
      }

      const method = options?.method ?? endpoint.method;

      // Find the query key for this endpoint
      const queryKey = Object.entries(queryEntries).find(([_, e]) => e === endpoint)?.[0];
      if (queryKey) {
        routeConfig[queryKey] = { method };
      }

      const normalizedPath = normalizeRoutePath(path);
      const fallbackRequiresAuth = endpoint.auth
        ? true
        : authStrategies.length > 0
          ? true
          : undefined;
      const requiresAuth =
        options?.requiresAuth ?? endpoint.metadata.requiresAuth ?? fallbackRequiresAuth;
      const visibility = options?.visibility ?? endpoint.metadata.visibility ?? "public";

      const metadata = {
        ...endpoint.metadata,
        path: normalizedPath,
        method,
        name: options?.name ?? endpoint.metadata.name ?? endpoint.key,
        summary: options?.summary ?? endpoint.metadata.summary,
        description: options?.description ?? endpoint.metadata.description,
        tags: mergeTags(endpoint.metadata.tags, options?.tags),
        requiresAuth,
        visibility,
      } satisfies ServeEndpoint["metadata"];

      const middlewares = [...endpoint.middlewares, ...(options?.middlewares ?? [])];

      const registeredEndpoint: ServeEndpoint<any, any, TContext, TAuth> = {
        ...endpoint,
        method,
        metadata,
        middlewares,
      };

      router.register(registeredEndpoint);
      return builder;
    },

    use: (middleware: ServeMiddleware<any, any, TContext, TAuth>) => {
      globalMiddlewares.push(middleware);
      return builder;
    },

    useAuth: (strategy: AuthStrategy<TAuth>) => {
      authStrategies.push(strategy);
      router.markRoutesRequireAuth();
      return builder;
    },

    execute: executeQuery,
    run: executeQuery,

    describe: () => {
      const description = {
        basePath: basePath || undefined,
        queries: router.list().map(mapEndpointToToolkit),
      };
      return description;
    },

    handler,
    start: async (options: StartServerOptions = {}) => {
      const { startNodeServer } = require("../adapters/node.js");
      return startNodeServer(handler, options);
    },
  };

  return builder;
};
