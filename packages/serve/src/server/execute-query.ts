import type {
  AuthContext,
  AuthStrategy,
  ErrorEnvelope,
  SchemaInput,
  ServeContextFactory,
  ServeEndpoint,
  ServeEndpointMap,
  ServeEndpointResult,
  ServeLifecycleHooks,
  ServeMiddleware,
  ServeQueriesMap,
  ServeRequest,
  TenantConfig,
} from "../types.js";
import { ServeQueryLogger } from "../query-logger.js";
import { executeEndpoint } from "../pipeline.js";

export const createExecuteQuery = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  queryEntries: ServeEndpointMap<any, TContext, TAuth>,
  authStrategies: AuthStrategy<TAuth>[],
  contextFactory: ServeContextFactory<TContext, TAuth> | undefined,
  globalMiddlewares: ServeMiddleware<any, any, TContext, TAuth>[],
  tenantConfig: TenantConfig<TAuth> | undefined,
  hooks: ServeLifecycleHooks<TAuth>,
  queryLogger: ServeQueryLogger,
  verboseAuthErrors: boolean,
) => {
  return async <TKey extends keyof typeof queryEntries>(
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
      tenantConfig,
      hooks,
      queryLogger,
      additionalContext: options?.context,
      verboseAuthErrors,
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
};
