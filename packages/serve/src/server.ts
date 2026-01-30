import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { startNodeServer } from "./adapters/node.js";
import { createEndpoint } from "./endpoint.js";
import { buildOpenApiDocument } from "./openapi.js";
import { applyBasePath, normalizeRoutePath, ServeRouter } from "./router.js";
import { buildDocsHtml } from "./docs-ui.js";
import { createTenantScope, warnTenantMisconfiguration } from "./tenant.js";
import { ServeQueryLogger } from "./query-logger.js";
import type {
  AuthContext,
  AuthStrategy,
  DocsOptions,
  EndpointContext,
  EndpointMetadata,
  ErrorEnvelope,
  OpenApiOptions,
  ExecutableQuery,
  HttpMethod,
  InferExecutableQueryResult,
  QueryProcedureBuilder,
  SchemaInput,
  SchemaOutput,
  ServeBuilder,
  ServeConfig,
  ServeContextFactory,
  ServeEndpoint,
  ServeEndpointMap,
  ServeEndpointResult,
  ServeInitializer,
  ServeHandler,
  ServeMiddleware,
  ServeQueriesMap,
  ServeQueryConfig,
  ServeRequest,
  ServeResponse,
  ServeLifecycleHooks,
  MaybePromise,
  TenantConfig,
  ToolkitDescription,
  ToolkitQueryDescription,
} from "./types.js";

const ensureArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const generateRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

type ProcedureBuilderState<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> = {
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  description?: string;
  name?: string;
  summary?: string;
  tags: string[];
  method?: HttpMethod;
  cacheTtlMs?: number | null;
  auth?: AuthStrategy<TAuth> | null;
  tenant?: TenantConfig<TAuth>;
  custom?: Record<string, unknown>;
  middlewares: ServeMiddleware<any, any, TContext, TAuth>[];
};

const createProcedureBuilder = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(): QueryProcedureBuilder<TContext, TAuth> => {
  const build = <
    TInputSchema extends ZodTypeAny | undefined = undefined,
    TOutputSchema extends ZodTypeAny = ZodTypeAny
  >(
    state: ProcedureBuilderState<TContext, TAuth>
  ): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema> => {
    return {
      input: <TNewInputSchema extends ZodTypeAny>(schema: TNewInputSchema) =>
        build<TNewInputSchema, TOutputSchema>({ ...state, inputSchema: schema }),
      output: <TNewOutputSchema extends ZodTypeAny>(schema: TNewOutputSchema) =>
        build<TInputSchema, TNewOutputSchema>({ ...state, outputSchema: schema }),
      describe: (description) => build<TInputSchema, TOutputSchema>({ ...state, description }),
      name: (name) => build<TInputSchema, TOutputSchema>({ ...state, name }),
      summary: (summary) => build<TInputSchema, TOutputSchema>({ ...state, summary }),
      tag: (tag) =>
        build<TInputSchema, TOutputSchema>({
          ...state,
          tags: Array.from(new Set([...state.tags, tag])),
        }),
      tags: (tags) =>
        build<TInputSchema, TOutputSchema>({
          ...state,
          tags: Array.from(new Set([...state.tags, ...(tags ?? [])])),
        }),
      method: (method) => build<TInputSchema, TOutputSchema>({ ...state, method }),
      cache: (ttlMs) => build<TInputSchema, TOutputSchema>({ ...state, cacheTtlMs: ttlMs }),
      auth: (strategy) => build<TInputSchema, TOutputSchema>({ ...state, auth: strategy }),
      tenant: (config) => build<TInputSchema, TOutputSchema>({ ...state, tenant: config }),
      custom: (custom) =>
        build<TInputSchema, TOutputSchema>({
          ...state,
          custom: { ...(state.custom ?? {}), ...custom },
        }),
      use: (...middlewares) =>
        build<TInputSchema, TOutputSchema>({
          ...state,
          middlewares: [...state.middlewares, ...middlewares],
        }),
      query: <
        TExecutable extends ExecutableQuery<SchemaInput<TInputSchema>, any, TContext, TAuth>
      >(
        executable: TExecutable
      ) => {
        type TResult = InferExecutableQueryResult<TExecutable>;
        const base: ServeQueryConfig<TInputSchema, TOutputSchema, TContext, TAuth, TResult> = {
          description: state.description,
          name: state.name,
          summary: state.summary,
          tags: state.tags,
          method: state.method,
          inputSchema: state.inputSchema as TInputSchema,
          outputSchema: state.outputSchema as TOutputSchema,
          cacheTtlMs: state.cacheTtlMs,
          auth: typeof state.auth === "undefined" ? null : state.auth,
          tenant: state.tenant,
          custom: state.custom,
          middlewares: state.middlewares as ServeMiddleware<
            SchemaInput<TInputSchema>,
            SchemaOutput<TOutputSchema>,
            TContext,
            TAuth
          >[],
          query: executable as ExecutableQuery<SchemaInput<TInputSchema>, TResult, TContext, TAuth>,
        };
        return base;
      },
    };
  };

  return build({ tags: [], middlewares: [] });
};

const getRequestId = (request: ServeRequest): string => {
  return (
    request.headers["x-request-id"] ??
    request.headers["x-trace-id"] ??
    generateRequestId()
  );
};

const safeInvokeHook = async <T>(
  name: string,
  hook: ((event: T) => MaybePromise<void>) | undefined,
  payload: T
) => {
  if (!hook) {
    return;
  }

  try {
    await hook(payload);
  } catch (error) {
    console.error(`[hypequery/serve] ${name} hook failed`, error);
  }
};

const mergeTags = (existing: string[], next?: string[]) => {
  const merged = [...existing, ...(next ?? [])];
  return Array.from(new Set(merged.filter(Boolean)));
};

const createErrorResponse = (
  status: number,
  type: ErrorEnvelope["error"]["type"],
  message: string,
  details?: Record<string, unknown>
) => {
  return {
    status,
    body: {
      error: {
        type,
        message,
        ...(details ? { details } : {}),
      },
    },
  } satisfies ServeResponse<ErrorEnvelope>;
};

const buildContextInput = (request: ServeRequest) => {
  if (request.body !== undefined && request.body !== null) {
    return request.body;
  }

  if (request.query && Object.keys(request.query).length > 0) {
    return request.query;
  }

  return {};
};

const runMiddlewares = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(
  middlewares: ServeMiddleware<any, any, TContext, TAuth>[],
  ctx: EndpointContext<any, TContext, TAuth>,
  handler: () => Promise<unknown>
) => {
  let index = middlewares.length - 1;
  let next = handler;

  while (index >= 0) {
    const middleware = middlewares[index];
    const downstream = next;
    next = () => middleware(ctx, downstream);
    index -= 1;
  }

  return next();
};

const authenticateRequest = async <TAuth extends AuthContext>(
  strategies: AuthStrategy<TAuth>[],
  request: ServeRequest,
  metadata: EndpointMetadata
): Promise<TAuth | null> => {
  for (const strategy of strategies) {
    const result = await strategy({
      request,
      endpoint: metadata,
    });

    if (result) {
      return result;
    }
  }

  return null;
};

const gatherAuthStrategies = <TAuth extends AuthContext>(
  endpointStrategy: AuthStrategy<TAuth> | null,
  globalStrategies: AuthStrategy<TAuth>[]
) => {
  const strategies: AuthStrategy<TAuth>[] = [];

  if (endpointStrategy) {
    strategies.push(endpointStrategy);
  }

  return [...strategies, ...globalStrategies];
};

const computeRequiresAuth = <TAuth extends AuthContext>(
  metadata: EndpointMetadata,
  endpointStrategy: AuthStrategy<TAuth> | null,
  globalStrategies: AuthStrategy<TAuth>[]
) => {
  if (typeof metadata.requiresAuth === "boolean") {
    return metadata.requiresAuth;
  }

  if (endpointStrategy) {
    return true;
  }

  return globalStrategies.length > 0;
};

const validateInput = (schema: ZodTypeAny | undefined, payload: unknown) => {
  if (!schema) {
    return { success: true as const, data: payload };
  }

  const result = schema.safeParse(payload);
  return result.success
    ? { success: true as const, data: result.data }
    : { success: false as const, error: result.error };
};

const createOpenApiEndpoint = (
  path: string,
  getEndpoints: () => ServeEndpoint<any, any, any, any>[],
  openapiOptions?: OpenApiOptions
): ServeEndpoint<any, any, Record<string, unknown>, AuthContext> => {
  // Cache the OpenAPI document to avoid rebuilding on every request
  let cachedDocument: any = null;

  return {
    key: "__hypequery_openapi__",
    method: "GET",
    inputSchema: undefined,
    outputSchema: z.any(),
    handler: async () => {
      if (!cachedDocument) {
        cachedDocument = buildOpenApiDocument(getEndpoints(), openapiOptions);
      }
      return cachedDocument;
    },
    query: undefined,
    middlewares: [],
    auth: null,
    metadata: {
      path,
      method: "GET",
      name: "OpenAPI schema",
      summary: "OpenAPI schema",
      description: "Generated OpenAPI specification for the registered endpoints",
      tags: ["docs"],
      requiresAuth: false,
      deprecated: false,
      visibility: "internal",
    },
    cacheTtlMs: null,
  };
};

const createDocsEndpoint = (
  path: string,
  openapiPath: string,
  options?: DocsOptions
): ServeEndpoint<any, any, Record<string, unknown>, AuthContext> => ({
  key: "__hypequery_docs__",
  method: "GET",
  inputSchema: undefined,
  outputSchema: z.string(),
  handler: async () => buildDocsHtml(openapiPath, options),
  query: undefined,
  middlewares: [],
  auth: null,
  metadata: {
    path,
    method: "GET",
    name: "Docs",
    summary: "API documentation",
    description: "Auto-generated documentation for your hypequery endpoints",
    tags: ["docs"],
    requiresAuth: false,
    deprecated: false,
    visibility: "internal",
  },
  cacheTtlMs: null,
  defaultHeaders: {
    "content-type": "text/html; charset=utf-8",
  },
});

const cloneContext = <TContext extends Record<string, unknown>>(ctx: TContext | null | undefined) =>
  (ctx ? { ...ctx } : ({} as TContext));

const resolveContext = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(
  factory: ServeContextFactory<TContext, TAuth> | undefined,
  request: ServeRequest,
  auth: TAuth | null
): Promise<TContext> => {
  if (!factory) {
    return {} as TContext;
  }

  if (typeof factory === "function") {
    const value = await factory({ request, auth });
    return cloneContext(value);
  }

  return cloneContext(factory);
};

type ExecuteEndpointOptions<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> = {
  endpoint: ServeEndpoint<any, any, TContext, TAuth>;
  request: ServeRequest;
  requestId: string;
  authStrategies: AuthStrategy<TAuth>[];
  contextFactory: ServeContextFactory<TContext, TAuth> | undefined;
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[];
  globalTenantConfig: TenantConfig<TAuth> | undefined;
  hooks: ServeLifecycleHooks<TAuth>;
  queryLogger?: ServeQueryLogger;
  additionalContext?: Partial<TContext>;
};

const executeEndpoint = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(
  options: ExecuteEndpointOptions<TContext, TAuth>
): Promise<ServeResponse> => {
  const {
    endpoint,
    request,
    requestId,
    authStrategies,
    contextFactory,
    globalMiddlewares,
    globalTenantConfig,
    hooks,
    queryLogger,
    additionalContext,
  } = options;

  const locals: Record<string, unknown> = {};
  let cacheTtlMs: number | null | undefined = endpoint.cacheTtlMs ?? null;
  const setCacheTtl = (ttl: number | null) => {
    cacheTtlMs = ttl;
  };

  const context = {
    request,
    input: buildContextInput(request),
    auth: null,
    metadata: endpoint.metadata,
    locals,
    setCacheTtl,
  } as EndpointContext<any, TContext, TAuth>;
  const startedAt = Date.now();
  await safeInvokeHook("onRequestStart", hooks.onRequestStart, {
    requestId,
    queryKey: endpoint.key,
    metadata: endpoint.metadata,
    request,
    auth: context.auth,
  });

  if (queryLogger && queryLogger.listenerCount > 0) {
    queryLogger.emit({
      requestId,
      endpointKey: endpoint.key,
      path: endpoint.metadata.path ?? `/${endpoint.key}`,
      method: request.method,
      status: 'started',
      startTime: startedAt,
      input: request.body ?? request.query,
    });
  }

  try {
    const endpointAuth = (endpoint.auth as AuthStrategy<TAuth> | null) ?? null;
    const strategies = gatherAuthStrategies(endpointAuth, authStrategies);
    const requiresAuth = computeRequiresAuth(endpoint.metadata, endpointAuth, authStrategies);
    const metadataWithAuth: EndpointMetadata = {
      ...endpoint.metadata,
      requiresAuth,
    };

    context.metadata = metadataWithAuth;

    const authContext = await authenticateRequest(strategies, request, metadataWithAuth);

    if (!authContext && requiresAuth) {
      await safeInvokeHook("onAuthFailure", hooks.onAuthFailure, {
        requestId,
        queryKey: endpoint.key,
        metadata: metadataWithAuth,
        request,
        auth: context.auth,
        reason: "MISSING",
      });
      return createErrorResponse(401, "UNAUTHORIZED", "Authentication required", {
        reason: "missing_credentials",
        strategies_attempted: strategies.length,
        endpoint: endpoint.metadata.path,
      });
    }

    // After the auth check above, if requiresAuth is true, authContext is guaranteed to be non-null
    context.auth = authContext;
    const hydratedContext = await resolveContext(contextFactory, request, authContext);
    Object.assign(context, hydratedContext, additionalContext);

    // Tenant isolation: Extract and validate tenant ID if configured
    // Use endpoint-specific config, or fall back to global config
    const tenantConfig = endpoint.tenant ?? globalTenantConfig;

    if (tenantConfig) {
      const tenantRequired = tenantConfig.required !== false; // Default to true
      const tenantId = authContext ? tenantConfig.extract(authContext) : null;

      if (!tenantId && tenantRequired) {
        const errorMessage =
          tenantConfig.errorMessage ??
          "Tenant context is required but could not be determined from authentication";

        await safeInvokeHook("onError", hooks.onError, {
          requestId,
          queryKey: endpoint.key,
          metadata: metadataWithAuth,
          request,
          auth: context.auth,
          durationMs: Date.now() - startedAt,
          error: new Error(errorMessage),
        });

        return createErrorResponse(403, "UNAUTHORIZED", errorMessage, {
          reason: "missing_tenant_context",
          tenant_required: true,
        });
      }

      if (tenantId) {
        context.tenantId = tenantId;

        // Auto-inject tenant filtering if configured
        const mode = tenantConfig.mode ?? 'manual'; // Default to manual for backward compatibility
        const column = tenantConfig.column;

        if (mode === 'auto-inject' && column) {
          // Wrap all query builders in the context to auto-inject tenant filters
          const contextValues = context as Record<string, unknown>;
          for (const key of Object.keys(contextValues)) {
            const value = contextValues[key];
            // Check if it looks like a query builder (has a table method)
            if (value && typeof value === 'object' && 'table' in value && typeof value.table === 'function') {
              contextValues[key] = createTenantScope(value as { table: (name: string) => any }, { tenantId, column });
            }
          }
        } else if (mode === 'manual') {
          // Warn developers in manual mode to ensure they manually filter
          warnTenantMisconfiguration({
            queryKey: endpoint.key,
            hasTenantConfig: true,
            hasTenantId: true,
            mode: 'manual',
          });
        }
      } else if (tenantConfig && !tenantRequired) {
        // Optional tenant mode - warn if no tenant config when accessing user data
        warnTenantMisconfiguration({
          queryKey: endpoint.key,
          hasTenantConfig: true,
          hasTenantId: false,
          mode: tenantConfig.mode,
        });
      }
    }

    const validationResult = validateInput(endpoint.inputSchema, context.input);

    if (!validationResult.success) {
      await safeInvokeHook("onError", hooks.onError, {
        requestId,
        queryKey: endpoint.key,
        metadata: metadataWithAuth,
        request,
        auth: context.auth,
        durationMs: Date.now() - startedAt,
        error: validationResult.error,
      });
      return createErrorResponse(400, "VALIDATION_ERROR", "Request validation failed", {
        issues: validationResult.error.issues,
      });
    }

    context.input = validationResult.data;

    const pipeline = [
      ...globalMiddlewares,
      ...(endpoint.middlewares as ServeMiddleware<any, any, TContext, TAuth>[]),
    ];
    const result = await runMiddlewares<TContext, TAuth>(pipeline, context, () => endpoint.handler(context));
    const headers: Record<string, string> = { ...(endpoint.defaultHeaders ?? {}) };

    if (typeof cacheTtlMs === "number") {
      headers["cache-control"] = cacheTtlMs > 0 ? `public, max-age=${Math.floor(cacheTtlMs / 1000)}` : "no-store";
    }

    const durationMs = Date.now() - startedAt;
    await safeInvokeHook("onRequestEnd", hooks.onRequestEnd, {
      requestId,
      queryKey: endpoint.key,
      metadata: metadataWithAuth,
      request,
      auth: context.auth,
      durationMs,
      result,
    });

    if (queryLogger && queryLogger.listenerCount > 0) {
      queryLogger.emit({
        requestId,
        endpointKey: endpoint.key,
        path: endpoint.metadata.path ?? `/${endpoint.key}`,
        method: request.method,
        status: 'completed',
        startTime: startedAt,
        endTime: startedAt + durationMs,
        durationMs,
        input: context.input,
        responseStatus: 200,
        result,
      });
    }

    return {
      status: 200,
      headers,
      body: result,
    } satisfies ServeResponse;
  } catch (error) {
    const errorDurationMs = Date.now() - startedAt;
    await safeInvokeHook("onError", hooks.onError, {
      requestId,
      queryKey: endpoint.key,
      metadata: context.metadata,
      request,
      auth: context.auth,
      durationMs: errorDurationMs,
      error,
    });

    if (queryLogger && queryLogger.listenerCount > 0) {
      queryLogger.emit({
        requestId,
        endpointKey: endpoint.key,
        path: endpoint.metadata.path ?? `/${endpoint.key}`,
        method: request.method,
        status: 'error',
        startTime: startedAt,
        endTime: startedAt + errorDurationMs,
        durationMs: errorDurationMs,
        input: context.input,
        responseStatus: 500,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    return createErrorResponse(500, "INTERNAL_SERVER_ERROR", message);
  }
};

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

  const handler: ServeHandler = async (request) => {
    const requestId = getRequestId(request);
    const endpoint = router.match(request.method, request.path);

    if (!endpoint) {
      return createErrorResponse(
        404,
        "NOT_FOUND",
        `No endpoint registered for ${request.method} ${request.path}`
      );
    }

    return executeEndpoint<TContext, TAuth>({
      endpoint,
      request,
      requestId,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      globalTenantConfig,
      hooks,
      queryLogger,
    });
  };

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

    const requestId = getRequestId(request);

    const response = await executeEndpoint<TContext, TAuth>({
      endpoint,
      request,
      requestId,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      globalTenantConfig,
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
