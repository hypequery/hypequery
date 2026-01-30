import { zodToJsonSchema } from "zod-to-json-schema";

import { startNodeServer } from "./adapters/node.js";
import { createEndpoint } from "./endpoint.js";
import { applyBasePath, normalizeRoutePath, ServeRouter } from "./router.js";
import { buildDocsHtml } from "./docs-ui.js";
import { createTenantScope, warnTenantMisconfiguration } from "./tenant.js";
import { ServeQueryLogger, formatQueryEvent } from "./query-logger.js";
import type {
  AuthContext,
  AuthStrategy,
  ErrorEnvelope,
  HttpMethod,
  ServeBuilder,
  ServeConfig,
  ServeContextFactory,
  ServeEndpoint,
  ServeEndpointMap,
  ServeEndpointResult,
  ServeInitializer,
  ServeHandler,
  ServeLifecycleHooks,
  ServeMiddleware,
  ServeQueriesMap,
  ServeRequest,
  SchemaInput,
  ToolkitDescription,
  ToolkitQueryDescription,
  TenantConfig,
} from "./types.js";
import { createProcedureBuilder } from "./builder.js";
import { ensureArray, mergeTags } from "./utils.js";
import {
  createDocsEndpoint,
  createOpenApiEndpoint,
  createServeHandler,
  executeEndpoint,
} from "./pipeline.js";

export const defineServe = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  const TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
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
    } else {
      queryLogger.on((event) => {
        const line = formatQueryEvent(event);
        if (line) console.log(line);
      });
    }
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

  const handler: ServeHandler = createServeHandler<TContext, TAuth>({
    router,
    globalMiddlewares,
    authStrategies,
    tenantConfig: globalTenantConfig,
    contextFactory,
    hooks,
    queryLogger,
  });

  // Track route configuration for client config extraction
  const routeConfig: Record<string, { method: HttpMethod }> = {};

  const executeQuery = async <TKey extends keyof typeof queryEntries>(
    key: TKey,
    options?: {
      input?: SchemaInput<(typeof queryEntries)[TKey]['inputSchema']>;
      context?: Partial<TContext>;
      request?: Partial<ServeRequest>;
    }
  ): Promise<ServeEndpointResult<(typeof queryEntries)[TKey]>> => {
    const endpoint = queryEntries[key];
    if (!endpoint) {
      throw new Error(`No query registered for key ${String(key)}`);
    }

    const request: ServeRequest = {
      method: endpoint.method,
      path: options?.request?.path ?? endpoint.metadata.path ?? `/__execute/${String(key)}`,
      query: options?.request?.query ?? {},
      headers: options?.request?.headers ?? {},
      body: options?.input ?? options?.request?.body,
      raw: options?.request?.raw,
    };

    const response = await executeEndpoint<TContext, TAuth>({
      endpoint,
      request,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig: globalTenantConfig,
      hooks,
      queryLogger,
      additionalContext: options?.context,
    });

    if (response.status !== 200) {
      const errorBody = response.body as ErrorEnvelope;
      const error = new Error(errorBody.error.message);
      (error as any).type = errorBody.error.type;
      if (errorBody.error.details) {
        (error as any).details = errorBody.error.details;
      }
      throw error;
    }

    return response.body as ServeEndpointResult<(typeof queryEntries)[TKey]>;
  };

  const builder: ServeBuilder<typeof queryEntries, TContext, TAuth> = {
    queries: queryEntries,
    queryLogger,
    _routeConfig: routeConfig,
    route: (path, endpoint, options) => {
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
    use: (middleware) => {
      globalMiddlewares.push(middleware);
      return builder;
    },
    useAuth: (strategy) => {
      authStrategies.push(strategy);
      router.markRoutesRequireAuth();
      return builder;
    },
    execute: executeQuery,
    run: executeQuery,
    describe: () => {
      const description: ToolkitDescription = {
        basePath: basePath || undefined,
        queries: router.list().map(mapEndpointToToolkit),
      };
      return description;
    },
    handler,
    start: async (options) => startNodeServer(handler, options),
  };

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

const mapEndpointToToolkit = (
  endpoint: ServeEndpoint<any, any, any, any>
): ToolkitQueryDescription => {
  // Use type assertion to avoid deep type instantiation issues with zodToJsonSchema
  const inputSchema: unknown = endpoint.inputSchema
    ? zodToJsonSchema(endpoint.inputSchema as any, { target: "openApi3" })
    : undefined;
  const outputSchema: unknown = endpoint.outputSchema
    ? zodToJsonSchema(endpoint.outputSchema as any, { target: "openApi3" })
    : undefined;

  return {
    key: endpoint.key,
    path: endpoint.metadata.path,
    method: endpoint.method,
    name: endpoint.metadata.name ?? endpoint.key,
    summary: endpoint.metadata.summary,
    description: endpoint.metadata.description,
    tags: endpoint.metadata.tags,
    visibility: endpoint.metadata.visibility,
    requiresAuth: Boolean(endpoint.metadata.requiresAuth),
    requiresTenant: endpoint.tenant ? (endpoint.tenant.required !== false) : undefined,
    inputSchema,
    outputSchema,
    custom: endpoint.metadata.custom,
  };
};

type InferInitializerContext<
  TFactory,
  TAuth extends AuthContext
> = TFactory extends ServeContextFactory<infer TContext, TAuth> ? TContext : never;

type ServeInitializerOptions<
  TFactory extends ServeContextFactory<any, TAuth>,
  TAuth extends AuthContext
> = Omit<
  ServeConfig<
    InferInitializerContext<TFactory, TAuth>,
    TAuth,
    ServeQueriesMap<InferInitializerContext<TFactory, TAuth>, TAuth>
  >,
  "queries" | "context"
> & { context: TFactory };

type ServeInitializerDefinition<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth>
> = Omit<ServeConfig<TContext, TAuth, TQueries>, "context">;

export const initServe = <
  TFactory extends ServeContextFactory<any, TAuth>,
  TAuth extends AuthContext = AuthContext
>(options: ServeInitializerOptions<TFactory, TAuth>): ServeInitializer<
  InferInitializerContext<TFactory, TAuth>,
  TAuth
> => {
  type TContext = InferInitializerContext<TFactory, TAuth>;
  const { context, ...staticOptions } = options;
  const procedure = createProcedureBuilder<TContext, TAuth>();

  return {
    procedure,
    query: procedure,
    queries: <TQueries extends ServeQueriesMap<TContext, TAuth>>(
      definitions: TQueries
    ) => definitions,
    define: <const TQueries extends ServeQueriesMap<TContext, TAuth>>(
      config: ServeInitializerDefinition<TContext, TAuth, TQueries>
    ) => {
      return defineServe<TContext, TAuth, TQueries>({
        ...staticOptions,
        ...config,
        context: (context ?? {}) as ServeContextFactory<TContext, TAuth>,
      });
    },
  } satisfies ServeInitializer<TContext, TAuth>;
};
