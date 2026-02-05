import { z } from 'zod';
import type { AuthContext, AuthStrategy, DocsOptions, OpenApiOptions, ServeContextFactory, ServeEndpoint, ServeHandler, ServeLifecycleHooks, ServeMiddleware, ServeRequest, ServeResponse, TenantConfig } from './types.js';
import { ServeQueryLogger } from './query-logger.js';
export interface ExecuteEndpointOptions<TContext extends Record<string, unknown>, TAuth extends AuthContext> {
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
export declare const executeEndpoint: <TContext extends Record<string, unknown>, TAuth extends AuthContext>(options: ExecuteEndpointOptions<TContext, TAuth>) => Promise<ServeResponse>;
interface HandlerOptions<TContext extends Record<string, unknown>, TAuth extends AuthContext> {
    router: import('./router.js').ServeRouter;
    globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[];
    authStrategies: AuthStrategy<TAuth>[];
    tenantConfig?: TenantConfig<TAuth>;
    contextFactory?: ServeContextFactory<TContext, TAuth>;
    hooks?: ServeLifecycleHooks<TAuth>;
    queryLogger?: ServeQueryLogger;
    verboseAuthErrors?: boolean;
}
export declare const createServeHandler: <TContext extends Record<string, unknown>, TAuth extends AuthContext>({ router, globalMiddlewares, authStrategies, tenantConfig, contextFactory, hooks, queryLogger, verboseAuthErrors, }: HandlerOptions<TContext, TAuth>) => ServeHandler;
export declare const createOpenApiEndpoint: (path: string, getEndpoints: () => ServeEndpoint<any, any, any, any>[], options?: OpenApiOptions) => {
    key: string;
    method: "GET";
    inputSchema: undefined;
    outputSchema: z.ZodAny;
    handler: () => Promise<unknown>;
    query: undefined;
    middlewares: never[];
    auth: null;
    metadata: {
        path: string;
        method: "GET";
        name: string;
        summary: string;
        description: string;
        tags: string[];
        requiresAuth: false;
        deprecated: false;
        visibility: "internal";
    };
    cacheTtlMs: null;
};
export declare const createDocsEndpoint: (path: string, openapiPath: string, options?: DocsOptions) => {
    key: string;
    method: "GET";
    inputSchema: undefined;
    outputSchema: z.ZodString;
    handler: () => Promise<string>;
    query: undefined;
    middlewares: never[];
    auth: null;
    metadata: {
        path: string;
        method: "GET";
        name: string;
        summary: string;
        description: string;
        tags: string[];
        requiresAuth: false;
        deprecated: false;
        visibility: "internal";
    };
    cacheTtlMs: null;
    defaultHeaders: {
        'content-type': string;
    };
};
export {};
//# sourceMappingURL=pipeline.d.ts.map