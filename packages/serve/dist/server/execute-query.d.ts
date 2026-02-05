import type { AuthContext, AuthStrategy, SchemaInput, ServeContextFactory, ServeEndpointMap, ServeEndpointResult, ServeLifecycleHooks, ServeMiddleware, ServeRequest, TenantConfig } from "../types.js";
import { ServeQueryLogger } from "../query-logger.js";
export declare const createExecuteQuery: <TContext extends Record<string, unknown>, TAuth extends AuthContext>(queryEntries: ServeEndpointMap<any, TContext, TAuth>, authStrategies: AuthStrategy<TAuth>[], contextFactory: ServeContextFactory<TContext, TAuth> | undefined, globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[], tenantConfig: TenantConfig<TAuth> | undefined, hooks: ServeLifecycleHooks<TAuth>, queryLogger: ServeQueryLogger, verboseAuthErrors: boolean) => <TKey extends keyof typeof queryEntries>(key: TKey, options?: {
    input?: SchemaInput<(typeof queryEntries)[TKey]["inputSchema"]>;
    context?: Partial<TContext>;
    request?: Partial<ServeRequest>;
}) => Promise<ServeEndpointResult<(typeof queryEntries)[TKey]>>;
//# sourceMappingURL=execute-query.d.ts.map