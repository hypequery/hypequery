import { z, type ZodTypeAny } from "zod";

import { startNodeServer } from "./adapters/node";
import { createEndpoint } from "./endpoint";
import { buildOpenApiDocument } from "./openapi";
import { applyBasePath, normalizeRoutePath, ServeRouter } from "./router";
import { buildDocsHtml } from "./docs-ui";
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
  ToolkitDescription,
  ToolkitQueryDescription,
} from "./types";

const ensureArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
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
): ServeEndpoint<any, any, any> => ({
  key: "__hypequery_openapi__",
  method: "GET",
  inputSchema: undefined,
  outputSchema: z.any(),
  handler: async () => buildOpenApiDocument(getEndpoints(), openapiOptions),
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
});

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
    description: "Auto-generated documentation for your HypeQuery Serve endpoints",
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
  const contextFactory = config.context as ServeContextFactory<TAuth> | undefined;
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
    const endpoint = router.match(request.method, request.path);

    if (!endpoint) {
      return createErrorResponse(
        404,
        "NOT_FOUND",
        `No endpoint registered for ${request.method} ${request.path}`
      );
    }

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
        return createErrorResponse(401, "UNAUTHORIZED", "Authentication required");
      }

      context.auth = authContext;
      const hydratedContext = await resolveContext(contextFactory, request, authContext);
      Object.assign(context, hydratedContext);

      const validationResult = validateInput(endpoint.inputSchema, context.input);

      if (!validationResult.success) {
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

      return {
        status: 200,
        headers,
        body: result,
      } satisfies ServeResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      return createErrorResponse(500, "INTERNAL_SERVER_ERROR", message);
    }
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

      const request: ServeRequest = {
        method: endpoint.method,
        path: options?.request?.path ?? endpoint.metadata.path ?? `/__execute/${String(key)}`,
        query: options?.request?.query ?? {},
        headers: options?.request?.headers ?? {},
        body: options?.request?.body,
        raw: options?.request?.raw,
      };

      const locals: Record<string, unknown> = {};
      let cacheTtlMs: number | null | undefined = endpoint.cacheTtlMs ?? null;
      const setCacheTtl = (ttl: number | null) => {
        cacheTtlMs = ttl;
      };

      const context: EndpointContext<any, TAuth> = {
        request,
        input: (options?.input ?? {}) as any,
        auth: null,
        metadata: endpoint.metadata,
        locals,
        setCacheTtl,
      };

      const endpointAuth = (endpoint.auth as AuthStrategy<TAuth> | null) ?? null;
      const strategies = gatherAuthStrategies(endpointAuth, authStrategies);
      const requiresAuth = computeRequiresAuth(endpoint.metadata, endpointAuth, authStrategies);
      const metadataWithAuth: EndpointMetadata = {
        ...endpoint.metadata,
        requiresAuth,
      };
      context.metadata = metadataWithAuth;

      if (strategies.length > 0) {
        const authContext = await authenticateRequest(strategies, request, metadataWithAuth);
        if (!authContext && requiresAuth) {
          throw new Error("Authentication required");
        }
        context.auth = authContext;
        const hydratedContext = await resolveContext(contextFactory, request, authContext);
        Object.assign(context, hydratedContext, options?.context);
      } else {
        const hydratedContext = await resolveContext(contextFactory, request, null);
        Object.assign(context, hydratedContext, options?.context);
      }

      const validationResult = validateInput(endpoint.inputSchema, context.input);
      if (!validationResult.success) {
        throw new Error("Request validation failed");
      }
      context.input = validationResult.data;

      const pipeline = [...globalMiddlewares, ...(endpoint.middlewares as ServeMiddleware<any, any, TAuth>[])];
      const result = await runMiddlewares(pipeline, context, () => endpoint.handler(context));
      return result as SchemaOutput<typeof endpoint.outputSchema>;
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
  const inputSchema = endpoint.inputSchema
    ? (endpoint.inputSchema as ZodTypeAny).toString()
    : undefined;
  const outputSchema = endpoint.outputSchema
    ? (endpoint.outputSchema as ZodTypeAny).toString()
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
    inputSchema,
    outputSchema,
  };
};
