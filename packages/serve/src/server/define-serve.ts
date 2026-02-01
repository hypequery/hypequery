import type {
  AuthContext,
  AuthStrategy,
  HttpMethod,
  ServeBuilder,
  ServeConfig,
  ServeContextFactory,
  ServeEndpoint,
  ServeEndpointMap,
  ServeHandler,
  ServeLifecycleHooks,
  ServeMiddleware,
  ServeQueriesMap,
} from "../types.js";
import { createEndpoint } from "../endpoint.js";
import { ServeRouter, applyBasePath } from "../router.js";
import { ensureArray } from "../utils.js";
import { ServeQueryLogger, formatQueryEvent, formatQueryEventJSON } from "../query-logger.js";
import { createServeHandler } from "../pipeline.js";
import { createDocsEndpoint, createOpenApiEndpoint } from "../pipeline.js";
import { resolveCorsConfig } from "../cors.js";
import { createExecuteQuery } from "./execute-query.js";
import { createBuilderMethods } from "./builder.js";

export const defineServe = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
>(
  config: ServeConfig<TContext, TAuth, TQueries>
): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> => {
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

  const corsConfig = resolveCorsConfig(config.cors);

  const handler: ServeHandler = createServeHandler<TContext, TAuth>({
    router,
    globalMiddlewares,
    authStrategies,
    tenantConfig: globalTenantConfig,
    contextFactory,
    hooks,
    queryLogger,
    verboseAuthErrors: config.security?.verboseAuthErrors ?? false,
    corsConfig,
  });

  // Track route configuration for client config extraction
  const routeConfig: Record<string, { method: HttpMethod }> = {};

  const executeQuery = createExecuteQuery<TContext, TAuth>(
    queryEntries,
    authStrategies,
    contextFactory,
    globalMiddlewares,
    globalTenantConfig,
    hooks,
    queryLogger,
    config.security?.verboseAuthErrors ?? false, // Default to false for security
  );

  const builder = createBuilderMethods<TQueries, TContext, TAuth>(
    queryEntries,
    queryLogger,
    routeConfig,
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

  return builder;
};
