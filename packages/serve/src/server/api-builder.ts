import type {
  AuthContext,
  AuthStrategy,
  HypeQueryAPI,
  RouteManifest,
  RouteManifestEntry,
  ServeEndpoint,
  ServeEndpointMap,
  ServeMiddleware,
  ServeQueriesMap,
  ServeHandler,
  ExecuteQueryFunction,
  RouteRegistrationOptions,
} from "../types.js";
import type { ServeRouter } from "../router.js";
import type { CacheObservability } from "../cache-observability.js";
import type { ProtocolDeploymentContract } from "@hypequery/protocol";
import type { BuildProtocolDeploymentOptions } from "../protocol-adapter.js";
import { ServeQueryLogger } from "../query-logger.js";
import { mergeTags } from "../utils.js";
import { applyBasePath, normalizeRoutePath } from "../router.js";
import { mapEndpointToToolkit } from "./mapper.js";
import { attachDeploymentBuildSource } from "./deployment-build-source.js";

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
  executeQuery: ExecuteQueryFunction<
    ServeEndpointMap<TQueries, TContext, TAuth>,
    TContext,
    TAuth
  >,
  handler: ServeHandler,
  basePath: string,
  cacheObservability: CacheObservability,
  buildDeploymentContract: (
    options?: BuildProtocolDeploymentOptions,
  ) => ProtocolDeploymentContract,
  runtimeEntrypoints: readonly string[],
): HypeQueryAPI<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
  /**
   * Routes registered through `api.route()`, keyed by endpoint identity.
   *
   * `route()` adds a route to the router but leaves `queryEntries` holding the
   * auto-registered `/queries/<key>` convention endpoint. Both routes stay live,
   * but the manifest can only name one, and clients should be pointed at the one
   * the author declared explicitly. First registration wins, so calling `route()`
   * twice for the same endpoint keeps the manifest stable. Object identity is
   * required because entries such as `orders` and `dataset:orders` may have the
   * same `endpoint.key` while representing different operations.
   */
  const explicitRoutes = new WeakMap<
    ServeEndpoint<any, any, TContext, TAuth>,
    RouteManifestEntry
  >();

  const api: HypeQueryAPI<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> = {
    queries: queryEntries,
    queryLogger,
    cacheObservability,
    deploymentContract: buildDeploymentContract,

    manifest: (): RouteManifest => {
      const manifest: RouteManifest = {};
      for (const [key, endpoint] of Object.entries(queryEntries) as [
        string,
        ServeEndpoint<any, any, TContext, TAuth>,
      ][]) {
        manifest[key] = explicitRoutes.get(endpoint) ?? {
          method: endpoint.method,
          // queryEntries store the pre-basePath route; re-apply so the manifest
          // carries the full request path clients should call.
          path: applyBasePath(basePath, endpoint.metadata.path),
        };
      }
      return manifest;
    },

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

      if (!explicitRoutes.has(endpoint)) {
        explicitRoutes.set(endpoint, {
          method,
          path: applyBasePath(basePath, normalizedPath),
        });
      }

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

  attachDeploymentBuildSource(api, runtimeEntrypoints);

  return api;
};
