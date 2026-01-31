import type {
  AuthContext,
  AuthStrategy,
  HttpMethod,
  ServeBuilder,
  ServeEndpoint,
  ServeEndpointMap,
  ServeMiddleware,
  ServeRequest,
} from "../types.js";
import type { ServeRouter } from "../router.js";
import { mergeTags } from "../utils.js";
import { normalizeRoutePath } from "../router.js";

export const createBuilderMethods = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  queryEntries: ServeEndpointMap<any, TContext, TAuth>,
  queryLogger: any,
  routeConfig: Record<string, { method: HttpMethod }>,
  router: ServeRouter,
  authStrategies: AuthStrategy<TAuth>[],
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[],
  executeQuery: any,
  handler: any,
  basePath: string,
): ServeBuilder<typeof queryEntries, TContext, TAuth> => {
  const builder: any = {
    queries: queryEntries,
    queryLogger,
    _routeConfig: routeConfig,

    route: (path: string, endpoint: any, options: any = {}) => {
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

    use: (middleware: any) => {
      globalMiddlewares.push(middleware);
      return builder;
    },

    useAuth: (strategy: any) => {
      authStrategies.push(strategy);
      router.markRoutesRequireAuth();
      return builder;
    },

    execute: executeQuery,
    run: executeQuery,

    describe: () => {
      const { mapEndpointToToolkit } = require("./mapper.js");
      const description = {
        basePath: basePath || undefined,
        queries: router.list().map(mapEndpointToToolkit),
      };
      return description;
    },

    handler,
    start: async (options: any) => {
      const { startNodeServer } = require("../adapters/node.js");
      return startNodeServer(handler, options);
    },
  };

  return builder as ServeBuilder<typeof queryEntries, TContext, TAuth>;
};
