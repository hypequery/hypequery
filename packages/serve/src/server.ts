import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { startNodeServer } from "./adapters/node.js";
import { createEndpoint } from "./endpoint.js";
import { buildOpenApiDocument } from "./openapi.js";
import { applyBasePath, normalizeRoutePath, ServeRouter } from "./router.js";
import { buildDocsHtml } from "./docs-ui.js";
import { createTenantScope, warnTenantMisconfiguration } from "./tenant.js";
import type {
  AuthContext,
  AuthStrategy,
  DocsOptions,
  EndpointContext,
  EndpointMetadata,
  ErrorEnvelope,
  OpenApiOptions,
  SchemaOutput,
  ServeBuilder,
  ServeConfig,
  ServeContextFactory,
  ServeEndpoint,
  ServeHandler,
  ServeMiddleware,
  ServeQueriesMap,
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

const runMiddlewares = async <TAuth extends AuthContext>(
  middlewares: ServeMiddleware<any, any, TAuth>[],
  ctx: EndpointContext<any, TAuth>,
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
  getEndpoints: () => ServeEndpoint<any, any, any>[],
  openapiOptions?: OpenApiOptions
): ServeEndpoint<any, any, any> => {
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
): ServeEndpoint<any, any, any> => ({
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

const cloneContext = (ctx: Record<string, unknown> | null | undefined) => (ctx ? { ...ctx } : {});

const resolveContext = async <TAuth extends AuthContext>(
  factory: ServeContextFactory<TAuth> | undefined,
  request: ServeRequest,
  auth: TAuth | null
) => {
  if (!factory) {
    return {} as Record<string, unknown>;
  }

  if (typeof factory === "function") {
    const value = await factory({ request, auth });
    return cloneContext(value);
  }

  return cloneContext(factory);
};

type ExecuteEndpointOptions<TAuth extends AuthContext> = {
  endpoint: ServeEndpoint<any, any, any>;
  request: ServeRequest;
  requestId: string;
  authStrategies: AuthStrategy<TAuth>[];
  contextFactory: ServeContextFactory<TAuth> | undefined;
  globalMiddlewares: ServeMiddleware<any, any, TAuth>[];
  globalTenantConfig: TenantConfig<TAuth> | undefined;
  hooks: ServeLifecycleHooks<TAuth>;
  additionalContext?: Record<string, unknown>;
};

const executeEndpoint = async <TAuth extends AuthContext>(
  options: ExecuteEndpointOptions<TAuth>
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
  } as EndpointContext<any, TAuth>;
  const startedAt = Date.now();
  await safeInvokeHook("onRequestStart", hooks.onRequestStart, {
    requestId,
    queryKey: endpoint.key,
    metadata: endpoint.metadata,
    request,
    auth: context.auth,
  });

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
          for (const key of Object.keys(context)) {
            const value = context[key];
            // Check if it looks like a query builder (has a table method)
            if (value && typeof value === 'object' && 'table' in value && typeof value.table === 'function') {
              context[key] = createTenantScope(value as { table: (name: string) => any }, { tenantId, column });
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
      ...(endpoint.middlewares as ServeMiddleware<any, any, TAuth>[]),
    ];
    const result = await runMiddlewares(pipeline, context, () => endpoint.handler(context));
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

    return {
      status: 200,
      headers,
      body: result,
    } satisfies ServeResponse;
  } catch (error) {
    await safeInvokeHook("onError", hooks.onError, {
      requestId,
      queryKey: endpoint.key,
      metadata: context.metadata,
      request,
      auth: context.auth,
      durationMs: Date.now() - startedAt,
      error,
    });
    const message = error instanceof Error ? error.message : "Unexpected error";
    return createErrorResponse(500, "INTERNAL_SERVER_ERROR", message);
  }
};

export const defineServe = <
  TQueries extends ServeQueriesMap = ServeQueriesMap,
  TAuth extends AuthContext = AuthContext
>(config: ServeConfig<TQueries, TAuth>): ServeBuilder<Record<keyof TQueries, ServeEndpoint<any, any, any>>, TAuth> => {
  const basePath = config.basePath ?? "";
  const router = new ServeRouter(basePath);
  const globalMiddlewares: ServeMiddleware<any, any, TAuth>[] = [
    ...((config.middlewares ?? []) as ServeMiddleware<any, any, TAuth>[]),
  ];
  const authStrategies = ensureArray<AuthStrategy<TAuth>>(config.auth);
  const globalTenantConfig = config.tenant;
  const contextFactory = config.context as ServeContextFactory<TAuth> | undefined;
  const hooks = (config.hooks ?? {}) as ServeLifecycleHooks<TAuth>;
  const openapiConfig = {
    enabled: config.openapi?.enabled ?? true,
    path: config.openapi?.path ?? "/openapi.json",
  };
  const docsConfig = {
    enabled: config.docs?.enabled ?? true,
    path: config.docs?.path ?? "/docs",
  };
  const openapiPublicPath = applyBasePath(basePath, openapiConfig.path);

  const queryEntries = Object.entries(config.queries ?? ({} as TQueries)).reduce(
    (acc, [key, definition]) => {
      acc[key as keyof TQueries] = createEndpoint(
        key,
        definition as TQueries[keyof TQueries]
      );
      return acc;
    },
    {} as Record<keyof TQueries, ServeEndpoint<any, any, any>>
  );

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

    return executeEndpoint({
      endpoint,
      request,
      requestId,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      globalTenantConfig,
      hooks,
    });
  };

  const builder: ServeBuilder<typeof queryEntries, TAuth> = {
    queries: queryEntries,
    route: (path, endpoint, options) => {
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
        summary: options?.summary ?? endpoint.metadata.summary,
        description: options?.description ?? endpoint.metadata.description,
        tags: mergeTags(endpoint.metadata.tags, options?.tags),
        requiresAuth,
        visibility,
      } satisfies ServeEndpoint["metadata"];

      const middlewares = [...endpoint.middlewares, ...(options?.middlewares ?? [])];

      const registeredEndpoint: ServeEndpoint<any, any, any> = {
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
    execute: async (key, options) => {
      const endpoint = queryEntries[key as keyof TQueries];
      if (!endpoint) {
        throw new Error(`No query registered for key ${String(key)}`);
      }

      // Build a synthetic request for direct execution
      const request: ServeRequest = {
        method: endpoint.method,
        path: options?.request?.path ?? endpoint.metadata.path ?? `/__execute/${String(key)}`,
        query: options?.request?.query ?? {},
        headers: options?.request?.headers ?? {},
        body: options?.input ?? options?.request?.body,
        raw: options?.request?.raw,
      };

      const requestId = getRequestId(request);

      // Execute the endpoint directly using the shared helper
      const response = await executeEndpoint({
        endpoint,
        request,
        requestId,
        authStrategies,
        contextFactory,
        globalMiddlewares,
        globalTenantConfig,
        hooks,
        additionalContext: options?.context,
      });

      // If the response indicates an error, throw it
      if (response.status !== 200) {
        const errorBody = response.body as ErrorEnvelope;
        const error = new Error(errorBody.error.message);
        (error as any).type = errorBody.error.type;
        if (errorBody.error.details) {
          (error as any).details = errorBody.error.details;
        }
        throw error;
      }

      // Return the successful response body
      return response.body as SchemaOutput<typeof endpoint.outputSchema>;
    },
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
  endpoint: ServeEndpoint<any, any, any>
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
