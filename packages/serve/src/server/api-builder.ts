import type {
  AuthContext,
  AuthStrategy,
  HypeQueryAPI,
  HttpMethod,
  ServeEndpoint,
  ServeEndpointMap,
  ServeMiddleware,
  ServeRequest,
  ServeQueriesMap,
  ServeHandler,
  ExecuteQueryFunction,
  RouteRegistrationOptions,
} from "../types.js";
import type { ServeRouter } from "../router.js";
import { ServeQueryLogger } from "../query-logger.js";
import { mergeTags } from "../utils.js";
import { normalizeRoutePath } from "../router.js";
import { mapEndpointToToolkit } from "./mapper.js";

export const createAPImethods = <
  TQueries extends ServeQueriesMap<TContext, TAuth>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  queryEntries: ServeEndpointMap<TQueries, TContext, TAuth>,
  queryLogger: ServeQueryLogger,
  router: ServeRouter,
  authStrategies: AuthStrategy<TAuth>[],
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[],
  executeQuery: ExecuteQueryFunction<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>,
  handler: ServeHandler,
  basePath: string,
): HypeQueryAPI<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
  const api: HypeQueryAPI<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> = {
    queries: queryEntries,
    queryLogger,

    route: (path: string, endpoint: ServeEndpoint<any, any, TContext, TAuth>, options: Partial<RouteRegistrationOptions<TContext, TAuth>> = {}) => {
      if (!endpoint) {
        throw new Error("Endpoint definition is required when registering a route");
      }

      const method = options?.method ?? endpoint.method;

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
      return api;
    },

    use: (middleware: ServeMiddleware<any, any, TContext, TAuth>) => {
      globalMiddlewares.push(middleware);
      return api;
    },

    useAuth: (strategy: AuthStrategy<TAuth>) => {
      authStrategies.push(strategy);
      router.markRoutesRequireAuth();
      return api;
    },

    execute: executeQuery,
    client: executeQuery,
    run: executeQuery,

    describe: () => {
      const description = {
        basePath: basePath || undefined,
        queries: router.list().map(mapEndpointToToolkit),
      };
      return description;
    },

    handler,
  };

  return api;
};
