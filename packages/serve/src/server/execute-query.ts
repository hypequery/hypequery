import type {
  AuthContext,
  ApiExecuteOptions,
  AuthStrategy,
  ErrorEnvelope,
  SchemaInput,
  ServeContextFactory,
  ServeEndpointMap,
  ServeEndpointResult,
  ServeLifecycleHooks,
  ServeMiddleware,
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
    options?: ApiExecuteOptions<
      SchemaInput<(typeof queryEntries)[TKey]['inputSchema']>,
      TContext,
      TAuth
    >,
  ): Promise<ServeEndpointResult<(typeof queryEntries)[TKey]>> => {
    const endpoint = queryEntries[key];
    if (!endpoint) {
      const availableQueries = Object.keys(queryEntries);
      const availableMessage =
        availableQueries.length > 0
          ? ` Available queries: ${availableQueries.join(", ")}.`
          : " No queries are currently registered.";
      throw new Error(`Query '${String(key)}' not found.${availableMessage}`);
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
      requestId: options?.requestId,
      additionalContext: options?.context,
      preauthenticatedAuth: options?.trustedAuth,
      verboseAuthErrors,
      sanitizeErrors: false, // In-process callers can see raw error messages
    });

    if (response.status !== 200) {
      const errorBody = response.body as ErrorEnvelope;
      const error = new Error(errorBody.error.message);
      (error as any).type = errorBody.error.type;
      (error as any).status = response.status;
      if (errorBody.error.details) {
        (error as any).details = errorBody.error.details;
      }
      throw error;
    }

    return response.body as ServeEndpointResult<(typeof queryEntries)[TKey]>;
  };
};
