import type {
  AuthContext,
  AuthStrategy,
  HypeQueryAPI,
  HttpMethod,
  ServeContextFactory,
  ServeEndpointMap,
  ServeHandler,
  ServeLifecycleHooks,
  ServeMiddleware,
  ServeQueriesMap,
  ServeConfig,
} from "../types.js";
import { createEndpoint } from "../endpoint.js";
import { ServeRouter, applyBasePath, normalizeRoutePath } from "../router.js";
import { ensureArray } from "../utils.js";
import { ServeQueryLogger, formatQueryEvent, formatQueryEventJSON } from "../query-logger.js";
import { createServeHandler } from "../pipeline.js";
import { createDocsEndpoint, createOpenApiEndpoint } from "../pipeline.js";
import { createExecuteQuery } from "./execute-query.js";
import { createAPImethods } from "./api-builder.js";
import { createMetricEndpoint, createDatasetEndpoint } from "../semantic/datasets/index.js";

const assertSemanticKeyAvailable = (
  queryEntries: Record<string, unknown>,
  key: string,
  kind: "metric" | "dataset",
) => {
  if (key in queryEntries) {
    throw new Error(
      `createAPI: ${kind} "${key}" collides with an existing query key. ` +
      `Rename the ${kind} or the query to keep api.queries and api.execute() unambiguous.`,
    );
  }
};

/**
 * Create a transport-agnostic API definition.
 *
 * `createAPI` sets up queries, auth, tenancy, caching, and middleware —
 * without binding to any HTTP server or runtime. Use standalone transport
 * functions to serve the API:
 *
 * @example
 * ```ts
 * import { createAPI } from '@hypequery/serve';
 * import { startServer, toFetchHandler, toNodeHandler } from '@hypequery/serve';
 *
 * const api = createAPI({
 *   auth: jwtStrategy,
 *   queries: {
 *     revenue: { query: async () => db.table('orders').sum('amount').execute() },
 *   },
 * });
 *
 * // Standalone server
 * startServer(api, { port: 3000 });
 *
 * // Express / Node.js middleware
 * app.use('/analytics', toNodeHandler(api));
 *
 * // Serverless (Vercel, Cloudflare, etc.)
 * export default toFetchHandler(api);
 * ```
 */
export const createAPI = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
>(
  config: ServeConfig<TContext, TAuth, TQueries>
): HypeQueryAPI<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
  const basePath = config.basePath ?? "/api/analytics";
  const router = new ServeRouter(basePath);
  const globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[] = [
    ...((config.middlewares ?? []) as ServeMiddleware<any, any, TContext, TAuth>[]),
  ];
  const authStrategies = ensureArray<AuthStrategy<TAuth>>(config.auth);
  const globalTenantConfig = config.tenant;
  const baseContextFactory = config.context as ServeContextFactory<TContext, TAuth> | undefined;
  const contextFactory: ServeContextFactory<TContext, TAuth> | undefined = baseContextFactory
    ? async ({ request, auth }) => {
        return baseContextFactory
          ? typeof baseContextFactory === "function"
            ? await baseContextFactory({ request, auth })
            : baseContextFactory
          : ({} as TContext);
      }
    : undefined;
  const hooks = (config.hooks ?? {}) as ServeLifecycleHooks<TAuth>;
  const queryLogger = new ServeQueryLogger();

  // Wire up production query logging if configured
  if (config.queryLogging) {
    if (typeof config.queryLogging === 'function') {
      queryLogger.on(config.queryLogging);
    } else if (config.queryLogging === 'json') {
      queryLogger.on((event) => {
        const line = formatQueryEventJSON(event);
        if (line) console.log(line);
      });
    } else {
      queryLogger.on((event) => {
        const line = formatQueryEvent(event);
        if (line) console.log(line);
      });
    }
  }

  // Slow query warning
  if (config.slowQueryThreshold != null) {
    queryLogger.on((event) => {
      if (event.status === 'completed' && event.durationMs && event.durationMs > config.slowQueryThreshold!) {
        console.warn(`[hypequery/slow-query] ${event.method} ${event.path} took ${event.durationMs}ms (threshold: ${config.slowQueryThreshold}ms)`);
      }
    });
  }

  const openapiConfig = {
    enabled: config.openapi?.enabled ?? true,
    path: config.openapi?.path ?? "/openapi.json",
  };
  const docsConfig = {
    enabled: config.docs?.enabled ?? true,
    path: config.docs?.path ?? "/docs",
  };
  const openapiPublicPath = applyBasePath(basePath, openapiConfig.path);

  const configuredQueries = config.queries ?? ({} as TQueries);
  const queryEntries = {} as ServeEndpointMap<TQueries, TContext, TAuth>;
  for (const key of Object.keys(configuredQueries) as Array<keyof TQueries>) {
    const endpoint = createEndpoint<TContext, TAuth, TQueries[typeof key]>(
      String(key),
      configuredQueries[key],
    );
    const routePath = normalizeRoutePath(`/queries/${String(key)}`);

    const registeredEndpoint = {
      ...endpoint,
      metadata: { ...endpoint.metadata, path: routePath },
    };

    queryEntries[key as keyof TQueries] = registeredEndpoint as any;
    router.register(registeredEndpoint);
  }

  // Process metrics — auto-generate POST endpoints
  if (config.metrics) {
    const metricsEntries = config.metrics;
    const semanticExecutor = config.semanticExecutor;

    if (!semanticExecutor) {
      throw new Error(
        'createAPI: `semanticExecutor` is required when `metrics` is provided. ' +
        'Pass createExecutor({ backend }) or createDatasetClient(config).',
      );
    }

    for (const [name, entry] of Object.entries(metricsEntries)) {
      assertSemanticKeyAvailable(queryEntries as Record<string, unknown>, name, "metric");
      const metricEndpoint = createMetricEndpoint(name, entry, semanticExecutor);
      const metricsPath = config.semanticPaths?.metrics ?? '/metrics';
      const routePath = normalizeRoutePath(`${metricsPath}/${name}`);

      const registeredEndpoint = {
        ...metricEndpoint,
        metadata: { ...metricEndpoint.metadata, path: routePath },
      };

      (queryEntries as Record<string, any>)[name] = registeredEndpoint;
      router.register(registeredEndpoint);
    }
  }

  // Process datasets — auto-generate POST endpoints for semantic dataset queries
  if (config.datasets) {
    const datasetEntries = config.datasets;
    const semanticExecutor = config.semanticExecutor;

    if (!semanticExecutor) {
      throw new Error(
        'createAPI: `semanticExecutor` is required when `datasets` is provided. ' +
        'Pass createExecutor({ backend }) or createDatasetClient(config).',
      );
    }

    for (const [name, entry] of Object.entries(datasetEntries)) {
      assertSemanticKeyAvailable(queryEntries as Record<string, unknown>, `dataset:${name}`, "dataset");
      const datasetEndpoint = createDatasetEndpoint(
        name,
        entry,
        semanticExecutor,
      );
      const datasetsPath = config.semanticPaths?.datasets ?? '/datasets';
      const routePath = normalizeRoutePath(`${datasetsPath}/${name}/query`);

      const registeredEndpoint = {
        ...datasetEndpoint,
        metadata: { ...datasetEndpoint.metadata, path: routePath },
      };

      (queryEntries as Record<string, any>)[`dataset:${name}`] = registeredEndpoint;
      router.register(registeredEndpoint);
    }
  }

  const handler: ServeHandler = createServeHandler<TContext, TAuth>({
    router,
    globalMiddlewares,
    authStrategies,
    tenantConfig: globalTenantConfig,
    contextFactory,
    hooks,
    queryLogger,
    verboseAuthErrors: config.security?.verboseAuthErrors ?? false,
  });

  const executeQuery = createExecuteQuery<TContext, TAuth>(
    queryEntries,
    authStrategies,
    contextFactory,
    globalMiddlewares,
    globalTenantConfig,
    hooks,
    queryLogger,
    config.security?.verboseAuthErrors ?? false,
  );

  const api = createAPImethods<TQueries, TContext, TAuth>(
    queryEntries,
    queryLogger,
    router,
    authStrategies,
    globalMiddlewares,
    executeQuery,
    handler,
    basePath,
  );

  if (openapiConfig.enabled) {
    const openapiEndpoint = createOpenApiEndpoint(
      openapiConfig.path,
      () => router.list(),
      config.openapi
    );
    router.register(openapiEndpoint);
  }

  if (docsConfig.enabled) {
    const docsEndpoint = createDocsEndpoint(
      docsConfig.path,
      openapiPublicPath,
      config.docs
    );
    router.register(docsEndpoint);
  }

  return api;
};
