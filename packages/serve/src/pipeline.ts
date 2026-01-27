import { z, type ZodTypeAny } from 'zod';

import type {
  AuthContext,
  AuthStrategy,
  DocsOptions,
  EndpointContext,
  EndpointMetadata,
  ErrorEnvelope,
  HttpMethod,
  OpenApiOptions,
  ServeContextFactory,
  ServeEndpoint,
  ServeHandler,
  ServeLifecycleHooks,
  ServeMiddleware,
  ServeRequest,
  ServeResponse,
  TenantConfig,
  MaybePromise,
} from './types.js';
import { createTenantScope, warnTenantMisconfiguration } from './tenant.js';
import { generateRequestId } from './utils.js';
import { buildOpenApiDocument } from './openapi.js';
import { buildDocsHtml } from './docs-ui.js';

const safeInvokeHook = async <T>(
  name: string,
  hook: ((event: T) => MaybePromise<void>) | undefined,
  payload: T,
) => {
  if (!hook) return;
  try {
    await hook(payload);
  } catch (error) {
    console.error(`[hypequery/serve] ${name} hook failed`, error);
  }
};

const createErrorResponse = (
  status: number,
  type: ErrorEnvelope['error']['type'],
  message: string,
  details?: Record<string, unknown>,
) => ({
  status,
  body: { error: { type, message, ...(details ? { details } : {}) } },
}) satisfies ServeResponse<ErrorEnvelope>;

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
  TAuth extends AuthContext,
  TResult,
>(
  middlewares: ServeMiddleware<any, TResult, TContext, TAuth>[],
  ctx: EndpointContext<any, TContext, TAuth>,
  handler: () => Promise<TResult>,
) => {
  let current = handler;
  for (let i = middlewares.length - 1; i >= 0; i -= 1) {
    const middleware = middlewares[i];
    const next = current;
    current = () => middleware(ctx, next);
  }
  return current();
};

const authenticateRequest = async <TAuth extends AuthContext>(
  strategies: AuthStrategy<TAuth>[],
  request: ServeRequest,
  metadata: EndpointMetadata,
) => {
  for (const strategy of strategies) {
    const result = await strategy({ request, endpoint: metadata });
    if (result) {
      return result;
    }
  }
  return null;
};

const gatherAuthStrategies = <TAuth extends AuthContext>(
  endpointStrategy: AuthStrategy<TAuth> | null,
  globalStrategies: AuthStrategy<TAuth>[],
) => {
  const combined = [] as AuthStrategy<TAuth>[];
  if (endpointStrategy) combined.push(endpointStrategy);
  combined.push(...globalStrategies);
  return combined;
};

const computeRequiresAuth = <TAuth extends AuthContext>(
  metadata: EndpointMetadata,
  endpointStrategy: AuthStrategy<TAuth> | null,
  globalStrategies: AuthStrategy<TAuth>[],
) => {
  if (typeof metadata.requiresAuth === 'boolean') {
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

const cloneContext = <TContext extends Record<string, unknown>>(ctx: TContext | null | undefined) =>
  (ctx ? { ...ctx } : ({} as TContext));

const resolveContext = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  factory: ServeContextFactory<TContext, TAuth> | undefined,
  request: ServeRequest,
  auth: TAuth | null,
): Promise<TContext> => {
  if (!factory) {
    return {} as TContext;
  }
  if (typeof factory === 'function') {
    const value = await factory({ request, auth });
    return cloneContext(value);
  }
  return cloneContext(factory);
};

const resolveRequestId = (request: ServeRequest, provided?: string) =>
  provided ?? request.headers['x-request-id'] ?? request.headers['x-trace-id'] ?? generateRequestId();

export interface ExecuteEndpointOptions<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
> {
  endpoint: ServeEndpoint<any, any, TContext, TAuth>;
  request: ServeRequest;
  requestId?: string;
  authStrategies: AuthStrategy<TAuth>[];
  contextFactory?: ServeContextFactory<TContext, TAuth>;
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[];
  tenantConfig?: TenantConfig<TAuth>;
  hooks?: ServeLifecycleHooks<TAuth>;
  additionalContext?: Partial<TContext>;
}

export const executeEndpoint = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  options: ExecuteEndpointOptions<TContext, TAuth>,
): Promise<ServeResponse> => {
  const {
    endpoint,
    request,
    requestId: explicitRequestId,
    authStrategies,
    contextFactory,
    globalMiddlewares,
    tenantConfig,
    hooks = {},
    additionalContext,
  } = options;

  const requestId = resolveRequestId(request, explicitRequestId);
  const locals: Record<string, unknown> = {};
  let cacheTtlMs: number | null | undefined = endpoint.cacheTtlMs ?? null;
  const setCacheTtl = (ttl: number | null) => {
    cacheTtlMs = ttl;
  };

  const context = {
    request,
    input: buildContextInput(request),
    auth: null as TAuth | null,
    metadata: endpoint.metadata,
    locals,
    setCacheTtl,
  } as EndpointContext<any, TContext, TAuth>;

  const startedAt = Date.now();
  await safeInvokeHook('onRequestStart', hooks.onRequestStart, {
    requestId,
    queryKey: endpoint.key,
    metadata: endpoint.metadata,
    request,
    auth: context.auth,
  });

  try {
    const endpointAuth = (endpoint.auth as AuthStrategy<TAuth> | null) ?? null;
    const strategies = gatherAuthStrategies(endpointAuth, authStrategies ?? []);
    const requiresAuth = computeRequiresAuth(endpoint.metadata, endpointAuth, authStrategies ?? []);
    const metadataWithAuth: EndpointMetadata = {
      ...endpoint.metadata,
      requiresAuth,
    };
    context.metadata = metadataWithAuth;

    const authContext = await authenticateRequest(strategies, request, metadataWithAuth);
    if (!authContext && requiresAuth) {
      await safeInvokeHook('onAuthFailure', hooks.onAuthFailure, {
        requestId,
        queryKey: endpoint.key,
        metadata: metadataWithAuth,
        request,
        auth: context.auth,
        reason: 'MISSING',
      });
      return createErrorResponse(401, 'UNAUTHORIZED', 'Authentication required', {
        reason: 'missing_credentials',
        strategies_attempted: strategies.length,
        endpoint: endpoint.metadata.path,
      });
    }

    context.auth = authContext;
    const resolvedContext = await resolveContext(contextFactory, request, authContext);
    Object.assign(context, resolvedContext, additionalContext);

    const activeTenantConfig = endpoint.tenant ?? tenantConfig;
    if (activeTenantConfig) {
      const tenantRequired = activeTenantConfig.required !== false;
      const tenantId = authContext ? activeTenantConfig.extract(authContext) : null;

      if (!tenantId && tenantRequired) {
        const errorMessage =
          activeTenantConfig.errorMessage ??
          'Tenant context is required but could not be determined from authentication';

        await safeInvokeHook('onError', hooks.onError, {
          requestId,
          queryKey: endpoint.key,
          metadata: metadataWithAuth,
          request,
          auth: context.auth,
          durationMs: Date.now() - startedAt,
          error: new Error(errorMessage),
        });

        return createErrorResponse(403, 'UNAUTHORIZED', errorMessage, {
          reason: 'missing_tenant_context',
          tenant_required: true,
        });
      }

      if (tenantId) {
        context.tenantId = tenantId;
        const mode = activeTenantConfig.mode ?? 'manual';
        const column = activeTenantConfig.column;

        if (mode === 'auto-inject' && column) {
          const contextValues = context as Record<string, unknown>;
          for (const key of Object.keys(contextValues)) {
            const value = contextValues[key];
            if (value && typeof value === 'object' && 'table' in value && typeof (value as any).table === 'function') {
              contextValues[key] = createTenantScope(value as { table: (name: string) => any }, {
                tenantId,
                column,
              });
            }
          }
        } else if (mode === 'manual') {
          warnTenantMisconfiguration({
            queryKey: endpoint.key,
            hasTenantConfig: true,
            hasTenantId: true,
            mode: 'manual',
          });
        }
      } else if (!tenantRequired) {
        warnTenantMisconfiguration({
          queryKey: endpoint.key,
          hasTenantConfig: true,
          hasTenantId: false,
          mode: activeTenantConfig.mode,
        });
      }
    }

    const validationResult = validateInput(endpoint.inputSchema, context.input);
    if (!validationResult.success) {
      await safeInvokeHook('onError', hooks.onError, {
        requestId,
        queryKey: endpoint.key,
        metadata: metadataWithAuth,
        request,
        auth: context.auth,
        durationMs: Date.now() - startedAt,
        error: validationResult.error,
      });
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Request validation failed', {
        issues: validationResult.error.issues,
      });
    }
    context.input = validationResult.data;

    const pipeline = [
      ...(globalMiddlewares ?? []),
      ...(endpoint.middlewares as ServeMiddleware<any, any, TContext, TAuth>[]),
    ];

    const result = await runMiddlewares(pipeline, context, () => endpoint.handler(context));
    const headers: Record<string, string> = { ...(endpoint.defaultHeaders ?? {}) };
    if (typeof cacheTtlMs === 'number') {
      headers['cache-control'] = cacheTtlMs > 0 ? `public, max-age=${Math.floor(cacheTtlMs / 1000)}` : 'no-store';
    }

    const durationMs = Date.now() - startedAt;
    await safeInvokeHook('onRequestEnd', hooks.onRequestEnd, {
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
    await safeInvokeHook('onError', hooks.onError, {
      requestId,
      queryKey: endpoint.key,
      metadata: context.metadata,
      request,
      auth: context.auth,
      durationMs: Date.now() - startedAt,
      error,
    });
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return createErrorResponse(500, 'INTERNAL_SERVER_ERROR', message);
  }
};

interface HandlerOptions<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
> {
  router: import('./router.js').ServeRouter;
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[];
  authStrategies: AuthStrategy<TAuth>[];
  tenantConfig?: TenantConfig<TAuth>;
  contextFactory?: ServeContextFactory<TContext, TAuth>;
  hooks?: ServeLifecycleHooks<TAuth>;
}

export const createServeHandler = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>({
  router,
  globalMiddlewares,
  authStrategies,
  tenantConfig,
  contextFactory,
  hooks,
}: HandlerOptions<TContext, TAuth>): ServeHandler => {
  return async (request) => {
    const endpoint = router.match(request.method as HttpMethod, request.path);
    if (!endpoint) {
      return createErrorResponse(
        404,
        'NOT_FOUND',
        `No endpoint registered for ${request.method} ${request.path}`,
      );
    }

    return executeEndpoint<TContext, TAuth>({
      endpoint,
      request,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
    });
  };
};

export const createOpenApiEndpoint = (
  path: string,
  getEndpoints: () => ServeEndpoint<any, any, any, any>[],
  options?: OpenApiOptions,
) => {
  let cachedDocument: unknown = null;
  return {
    key: '__hypequery_openapi__',
    method: 'GET',
    inputSchema: undefined,
    outputSchema: z.any(),
    handler: async () => {
      if (!cachedDocument) {
        cachedDocument = buildOpenApiDocument(getEndpoints(), options);
      }
      return cachedDocument;
    },
    query: undefined,
    middlewares: [],
    auth: null,
    metadata: {
      path,
      method: 'GET',
      name: 'OpenAPI schema',
      summary: 'OpenAPI schema',
      description: 'Generated OpenAPI specification for the registered endpoints',
      tags: ['docs'],
      requiresAuth: false,
      deprecated: false,
      visibility: 'internal',
    },
    cacheTtlMs: null,
  } satisfies ServeEndpoint<any, any, Record<string, unknown>, AuthContext>;
};

export const createDocsEndpoint = (
  path: string,
  openapiPath: string,
  options?: DocsOptions,
) => ({
  key: '__hypequery_docs__',
  method: 'GET',
  inputSchema: undefined,
  outputSchema: z.string(),
  handler: async () => buildDocsHtml(openapiPath, options),
  query: undefined,
  middlewares: [],
  auth: null,
  metadata: {
    path,
    method: 'GET',
    name: 'Docs',
    summary: 'API documentation',
    description: 'Auto-generated documentation for your hypequery endpoints',
    tags: ['docs'],
    requiresAuth: false,
    deprecated: false,
    visibility: 'internal',
  },
  cacheTtlMs: null,
  defaultHeaders: {
    'content-type': 'text/html; charset=utf-8',
  },
}) satisfies ServeEndpoint<any, any, Record<string, unknown>, AuthContext>;
