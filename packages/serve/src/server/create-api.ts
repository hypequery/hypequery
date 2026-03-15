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
import { MetricExecutor } from "../semantic/datasets/executor.js";
import { createMetricEndpoint } from "../semantic/datasets/metric-endpoint.js";
import { createDatasetEndpoint } from "../semantic/datasets/dataset-endpoint.js";
import type { MetricsBlock } from "../semantic/datasets/define-metrics.js";
import type { DatasetsBlock } from "../semantic/datasets/define-datasets.js";

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
 * import { serve, toFetchHandler, toNodeHandler } from '@hypequery/serve';
 *
 * const api = createAPI({
 *   auth: jwtStrategy,
 *   queries: {
 *     revenue: { query: async () => db.table('orders').sum('amount').execute() },
 *   },
 * });
 *
 * // Standalone server
 * serve(api, { port: 3000 });
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
  const contextFactory = config.context as ServeContextFactory<TContext, TAuth> | undefined;
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
  const registerQuery = (key: keyof TQueries, definition: TQueries[keyof TQueries]) => {
    queryEntries[key as keyof TQueries] = createEndpoint(String(key), definition);
  };
  for (const key of Object.keys(configuredQueries) as Array<keyof TQueries>) {
    registerQuery(key, configuredQueries[key]);
  }

  // Process metrics — auto-generate POST endpoints
  if (config.metrics) {
    const isBlock = (m: any): m is MetricsBlock<TAuth> =>
      m && typeof m === 'object' && m.__type === 'metrics_block';

    const metricsEntries = isBlock(config.metrics) ? config.metrics.entries : config.metrics;
    const metricsDefaults = isBlock(config.metrics) ? config.metrics.defaults : undefined;
    const builderFactory = config.queryBuilder;
    const adapter = config.metricAdapter;

    if (!builderFactory && !adapter) {
      throw new Error(
        'createAPI: `queryBuilder` (or deprecated `metricAdapter`) is required when `metrics` is provided. ' +
        'Pass the createQueryBuilder(config) return value as `queryBuilder`.',
      );
    }

    const executor = new MetricExecutor(
      builderFactory ? { builderFactory } : { adapter: adapter! },
    );

    for (const [name, entry] of Object.entries(metricsEntries)) {
      // Apply block-level defaults for inline entries (shorthand MetricRef)
      let resolvedEntry = entry;
      if (metricsDefaults) {
        const isRef = entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'metric_ref';
        if (isRef) {
          resolvedEntry = {
            metric: entry,
            cache: metricsDefaults.cache,
          };
        } else if (typeof entry === 'object' && 'metric' in entry) {
          resolvedEntry = {
            cache: metricsDefaults.cache,
            ...entry,
          };
        }
      }

      const metricEndpoint = createMetricEndpoint(name, resolvedEntry, executor);
      const routePath = normalizeRoutePath(`/metrics/${name}`);

      const registeredEndpoint = {
        ...metricEndpoint,
        metadata: { ...metricEndpoint.metadata, path: routePath },
      };

      (queryEntries as Record<string, any>)[name] = registeredEndpoint;
      router.register(registeredEndpoint);
    }
  }

  // Process datasets — auto-generate POST endpoints for row browsing
  if (config.datasets) {
    const isBlock = (d: any): d is DatasetsBlock<TAuth> =>
      d && typeof d === 'object' && d.__type === 'datasets_block';

    const datasetEntries = isBlock(config.datasets) ? config.datasets.entries : config.datasets;
    const datasetDefaults = isBlock(config.datasets) ? config.datasets.defaults : undefined;
    const builderFactory = config.queryBuilder;

    if (!builderFactory) {
      throw new Error(
        'createAPI: `queryBuilder` is required when `datasets` is provided. ' +
        'Pass the createQueryBuilder(config) return value as `queryBuilder`.',
      );
    }

    for (const [name, entry] of Object.entries(datasetEntries)) {
      const datasetEndpoint = createDatasetEndpoint(
        name,
        entry,
        builderFactory,
        datasetDefaults?.maxLimit,
      );
      const routePath = normalizeRoutePath(`/datasets/${name}/query`);

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
