import { z } from 'zod';
import { createTenantScope, warnTenantMisconfiguration } from './tenant.js';
import { generateRequestId } from './utils.js';
import { buildOpenApiDocument } from './openapi.js';
import { buildDocsHtml } from './docs-ui.js';
import { checkRoleAuthorization, checkScopeAuthorization, } from './auth.js';
const safeInvokeHook = async (name, hook, payload) => {
    if (!hook)
        return;
    try {
        await hook(payload);
    }
    catch (error) {
        console.error(`[hypequery/serve] ${name} hook failed`, error);
    }
};
const createErrorResponse = (status, type, message, details, headers) => ({
    status,
    headers,
    body: { error: { type, message, ...(details ? { details } : {}) } },
});
const buildContextInput = (request) => {
    if (request.body !== undefined && request.body !== null) {
        return request.body;
    }
    if (request.query && Object.keys(request.query).length > 0) {
        return request.query;
    }
    return undefined;
};
const runMiddlewares = async (middlewares, ctx, handler) => {
    let current = handler;
    for (let i = middlewares.length - 1; i >= 0; i -= 1) {
        const middleware = middlewares[i];
        const next = current;
        current = () => middleware(ctx, next);
    }
    return current();
};
const authenticateRequest = async (strategies, request, metadata) => {
    for (const strategy of strategies) {
        const result = await strategy({ request, endpoint: metadata });
        if (result) {
            return result;
        }
    }
    return null;
};
const gatherAuthStrategies = (endpointStrategy, globalStrategies) => {
    const combined = [];
    if (endpointStrategy)
        combined.push(endpointStrategy);
    combined.push(...globalStrategies);
    return combined;
};
const computeRequiresAuth = (metadata, endpointStrategy, globalStrategies, endpoint) => {
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
const checkAuthorization = (auth, requiredRoles, requiredScopes) => {
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
const validateInput = (schema, payload) => {
    if (!schema) {
        return { success: true, data: payload };
    }
    const result = schema.safeParse(payload);
    return result.success
        ? { success: true, data: result.data }
        : { success: false, error: result.error };
};
const cloneContext = (ctx) => (ctx ? { ...ctx } : {});
const resolveContext = async (factory, request, auth) => {
    if (!factory) {
        return {};
    }
    if (typeof factory === 'function') {
        const value = await factory({ request, auth });
        return cloneContext(value);
    }
    return cloneContext(factory);
};
const resolveRequestId = (request, provided) => provided ?? request.headers['x-request-id'] ?? request.headers['x-trace-id'] ?? generateRequestId();
export const executeEndpoint = async (options) => {
    const { endpoint, request, requestId: explicitRequestId, authStrategies, contextFactory, globalMiddlewares, tenantConfig, hooks = {}, queryLogger, additionalContext, verboseAuthErrors = false, // Default to secure mode for production safety
     } = options;
    const requestId = resolveRequestId(request, explicitRequestId);
    const locals = {};
    let cacheTtlMs = endpoint.cacheTtlMs ?? null;
    const setCacheTtl = (ttl) => {
        cacheTtlMs = ttl;
    };
    const context = {
        request,
        input: buildContextInput(request),
        auth: null,
        metadata: endpoint.metadata,
        locals,
        setCacheTtl,
    };
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
        const endpointAuth = endpoint.auth ?? null;
        const strategies = gatherAuthStrategies(endpointAuth, authStrategies ?? []);
        const requiresAuth = computeRequiresAuth(endpoint.metadata, endpointAuth, authStrategies ?? [], endpoint);
        const metadataWithAuth = {
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
            return createErrorResponse(401, 'UNAUTHORIZED', verboseAuthErrors ? 'Authentication required' : 'Access denied', {
                reason: 'missing_credentials',
                ...(verboseAuthErrors && { strategies_attempted: strategies.length }),
                endpoint: endpoint.metadata.path,
            }, { 'x-request-id': requestId });
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
            return createErrorResponse(403, 'FORBIDDEN', verboseAuthErrors
                ? `Missing required ${label}: ${authzResult.required.join(', ')}`
                : 'Insufficient permissions', {
                reason: authzResult.reason.toLowerCase(),
                ...(verboseAuthErrors && {
                    required: authzResult.required,
                    actual: authzResult.actual,
                }),
                endpoint: endpoint.metadata.path,
            });
        }
        const resolvedContext = await resolveContext(contextFactory, request, authContext);
        Object.assign(context, resolvedContext, additionalContext);
        const activeTenantConfig = endpoint.tenant ?? tenantConfig;
        if (activeTenantConfig) {
            const tenantRequired = activeTenantConfig.required !== false;
            const tenantId = authContext ? activeTenantConfig.extract(authContext) : null;
            if (!tenantId && tenantRequired) {
                const errorMessage = activeTenantConfig.errorMessage ??
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
                    const contextValues = context;
                    for (const key of Object.keys(contextValues)) {
                        const value = contextValues[key];
                        if (value && typeof value === 'object' && 'table' in value && typeof value.table === 'function') {
                            contextValues[key] = createTenantScope(value, {
                                tenantId,
                                column,
                            });
                        }
                    }
                }
                else if (mode === 'manual') {
                    warnTenantMisconfiguration({
                        queryKey: endpoint.key,
                        hasTenantConfig: true,
                        hasTenantId: true,
                        mode: 'manual',
                    });
                }
            }
            else if (!tenantRequired) {
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
            ...endpoint.middlewares,
        ];
        const result = await runMiddlewares(pipeline, context, () => endpoint.handler(context));
        const headers = {
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
        };
    }
    catch (error) {
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
export const createServeHandler = ({ router, globalMiddlewares, authStrategies, tenantConfig, contextFactory, hooks, queryLogger, verboseAuthErrors = false, }) => {
    return async (request) => {
        const requestId = resolveRequestId(request);
        const endpoint = router.match(request.method, request.path);
        if (!endpoint) {
            return createErrorResponse(404, 'NOT_FOUND', `No endpoint registered for ${request.method} ${request.path}`, undefined, { 'x-request-id': requestId });
        }
        return executeEndpoint({
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
export const createOpenApiEndpoint = (path, getEndpoints, options) => {
    let cachedDocument = null;
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
    };
};
export const createDocsEndpoint = (path, openapiPath, options) => ({
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
});
