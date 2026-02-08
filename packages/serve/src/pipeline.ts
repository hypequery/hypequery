import { z, type ZodTypeAny } from 'zod';

import type {
  AuthContext,
  AuthorizationFailureEvent,
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
  TenantConfigOverride,
  MaybePromise,
} from './types.js';
import { createTenantScope, warnTenantMisconfiguration } from './tenant.js';
import { generateRequestId } from './utils.js';
import { buildOpenApiDocument } from './openapi.js';
import { buildDocsHtml } from './docs-ui.js';
import { ServeQueryLogger } from './query-logger.js';
import {
  checkRoleAuthorization,
  checkScopeAuthorization,
} from './auth.js';

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
  headers?: Record<string, string>,
) => ({
  status,
  headers,
  body: { error: { type, message, ...(details ? { details } : {}) } },
}) satisfies ServeResponse<ErrorEnvelope>;

const buildContextInput = (request: ServeRequest) => {
  if (request.body !== undefined && request.body !== null) {
    return request.body;
  }
  if (request.query && Object.keys(request.query).length > 0) {
    return request.query;
  }
  return undefined;
};

const resolveTenantConfig = <TAuth extends AuthContext>(
  globalConfig: TenantConfig<TAuth> | undefined,
  override: TenantConfigOverride<TAuth> | undefined,
): TenantConfig<TAuth> | undefined => {
  if (!globalConfig && !override) {
    return undefined;
  }

  if (!override) {
    return globalConfig;
  }

  const merged = { ...(globalConfig ?? {}), ...(override ?? {}) } as TenantConfig<TAuth>;

  if (!merged.extract) {
    throw new Error(
      '[hypequery/serve] Tenant override requires an extract function when no global tenant config is set. ' +
        'If you are using tenantOptional(), define a global tenant config with extract or pass extract in the per-query override.'
    );
  }

  return merged;
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
  endpoint: ServeEndpoint<any, any, any, TAuth>,
) => {
  // Explicit .public() overrides everything
  if (metadata.requiresAuth === false) {
    return false;
  }
  // Explicit .requireAuth() or roles/scopes imply auth
  if (metadata.requiresAuth === true) {
    return true;
  }
  if ((endpoint.requiredRoles?.length ?? 0) > 0 || (endpoint.requiredScopes?.length ?? 0) > 0) {
    return true;
  }
  if (endpointStrategy) {
    return true;
  }
  return globalStrategies.length > 0;
};

const checkAuthorization = <TAuth extends AuthContext>(
  auth: TAuth | null,
  requiredRoles?: string[],
  requiredScopes?: string[],
): { ok: true } | { ok: false; reason: 'MISSING_ROLE' | 'MISSING_SCOPE'; required: string[]; actual: string[] } => {
  // Check roles first
  if (requiredRoles && requiredRoles.length > 0) {
    const roleResult = checkRoleAuthorization(auth, requiredRoles);
    if (!roleResult.ok) {
      const userRoles = auth?.roles ?? [];
      return { ok: false, reason: roleResult.reason, required: roleResult.missing, actual: userRoles };
    }
  }

  // Check scopes
  if (requiredScopes && requiredScopes.length > 0) {
    const scopeResult = checkScopeAuthorization(auth, requiredScopes);
    if (!scopeResult.ok) {
      const userScopes = auth?.scopes ?? [];
      return { ok: false, reason: scopeResult.reason, required: scopeResult.missing, actual: userScopes };
    }
  }

  return { ok: true };
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
  queryLogger?: ServeQueryLogger;
  additionalContext?: Partial<TContext>;
  verboseAuthErrors?: boolean;
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
    queryLogger,
    additionalContext,
    verboseAuthErrors = false, // Default to secure mode for production safety
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

  // Skip query logging if no listeners are subscribed
  if (queryLogger?.listenerCount ?? 0 > 0) {
    queryLogger?.emit({
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
    const strategies = gatherAuthStrategies(endpointAuth, authStrategies ?? []);
    const requiresAuth = computeRequiresAuth(endpoint.metadata, endpointAuth, authStrategies ?? [], endpoint);
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
      return createErrorResponse(
        401,
        'UNAUTHORIZED',
        verboseAuthErrors ? 'Authentication required' : 'Access denied',
        {
          reason: 'missing_credentials',
          ...(verboseAuthErrors && { strategies_attempted: strategies.length }),
          endpoint: endpoint.metadata.path,
        },
        { 'x-request-id': requestId }
      );
    }

    context.auth = authContext;

    // Check role/scope authorization after successful authentication
    const authzResult = checkAuthorization(authContext, endpoint.requiredRoles, endpoint.requiredScopes);
    if (!authzResult.ok) {
      const label = authzResult.reason === 'MISSING_ROLE' ? 'role' : 'scope';
      await safeInvokeHook('onAuthorizationFailure', hooks.onAuthorizationFailure, {
        requestId,
        queryKey: endpoint.key,
        metadata: metadataWithAuth,
        request,
        auth: authContext,
        reason: authzResult.reason,
        required: authzResult.required,
        actual: authzResult.actual,
      });
      return createErrorResponse(
        403,
        'FORBIDDEN',
        verboseAuthErrors
          ? `Missing required ${label}: ${authzResult.required.join(', ')}`
          : 'Insufficient permissions',
        {
          reason: authzResult.reason.toLowerCase(),
          ...(verboseAuthErrors && {
            required: authzResult.required,
            actual: authzResult.actual,
          }),
          endpoint: endpoint.metadata.path,
        }
      );
    }
    const resolvedContext = await resolveContext(contextFactory, request, authContext);
    Object.assign(context, resolvedContext, additionalContext);

    const activeTenantConfig = resolveTenantConfig(tenantConfig, endpoint.tenant);
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
        }, { 'x-request-id': requestId });
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
      }, { 'x-request-id': requestId });
    }
    context.input = validationResult.data;

    const pipeline = [
      ...(globalMiddlewares ?? []),
      ...(endpoint.middlewares as ServeMiddleware<any, any, TContext, TAuth>[]),
    ];

    const result = await runMiddlewares(pipeline, context, () => endpoint.handler(context));
    const headers: Record<string, string> = {
      ...(endpoint.defaultHeaders ?? {}),
      'x-request-id': requestId,
    };
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

    // Skip query logging if no listeners are subscribed
    if (queryLogger?.listenerCount ?? 0 > 0) {
      queryLogger?.emit({
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
    await safeInvokeHook('onError', hooks.onError, {
      requestId,
      queryKey: endpoint.key,
      metadata: context.metadata,
      request,
      auth: context.auth,
      durationMs: errorDurationMs,
      error,
    });

    // Skip query logging if no listeners are subscribed
    if (queryLogger?.listenerCount ?? 0 > 0) {
      queryLogger?.emit({
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

    const message = error instanceof Error ? error.message : 'Unexpected error';
    return createErrorResponse(500, 'INTERNAL_SERVER_ERROR', message, undefined, { 'x-request-id': requestId });
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
  queryLogger?: ServeQueryLogger;
  verboseAuthErrors?: boolean;
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
  queryLogger,
  verboseAuthErrors = false,
}: HandlerOptions<TContext, TAuth>): ServeHandler => {
  return async (request) => {
    const requestId = resolveRequestId(request);
    const endpoint = router.match(request.method as HttpMethod, request.path);
    if (!endpoint) {
      return createErrorResponse(
        404,
        'NOT_FOUND',
        `No endpoint registered for ${request.method} ${request.path}`,
        undefined,
        { 'x-request-id': requestId },
      );
    }

    return executeEndpoint<TContext, TAuth>({
      endpoint,
      request,
      requestId,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
      verboseAuthErrors,
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
