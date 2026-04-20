import type {
  AuthContext,
  DirectQueryExecuteOptions,
  QueryObjectConfig,
  QueryRuntimeContext,
  SchemaInput,
  SchemaOutput,
  ServeBuilder,
  ServeConfig,
  ServeContextFactory,
  ServeEndpointMap,
  ServeQueriesMap,
  ServeRequest,
  StandaloneQueryDefinition,
} from "./types.js";
import type { ZodTypeAny } from "zod";
import { defineServe } from "./server/define-serve.js";

const defaultRequest: ServeRequest = {
  method: "POST",
  path: "/__query/execute",
  query: {},
  headers: {},
};

const resolveContext = async <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
>(
  contextFactory: ServeContextFactory<TContext, TAuth> | undefined,
  request: ServeRequest,
): Promise<TContext> => {
  if (!contextFactory) {
    return {} as TContext;
  }

  if (typeof contextFactory === "function") {
    return await contextFactory({ request, auth: null });
  }

  return contextFactory;
};

const parseMaybe = <T>(schema: { parse: (value: unknown) => T } | undefined, value: unknown): T => {
  if (!schema) {
    return value as T;
  }

  return schema.parse(value);
};

const createStandaloneQuery = <
  TInputSchema extends ZodTypeAny | undefined,
  TOutputSchema extends ZodTypeAny | undefined,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
  TResult,
>(
  config: QueryObjectConfig<TInputSchema, TOutputSchema, TContext, TAuth, TResult>,
  contextFactory?: ServeContextFactory<TContext, TAuth>,
): StandaloneQueryDefinition<TInputSchema, TOutputSchema extends ZodTypeAny ? TOutputSchema : ZodTypeAny, TContext, TAuth, TResult> => {
  const run = config.query;

  const definition = {
    query: run,
    run,
    execute: async (options?: DirectQueryExecuteOptions<SchemaInput<TInputSchema>, TContext>) => {
      const request: ServeRequest = {
        method: options?.request?.method ?? config.method ?? "POST",
        path: options?.request?.path ?? defaultRequest.path,
        query: options?.request?.query ?? defaultRequest.query,
        headers: options?.request?.headers ?? defaultRequest.headers,
        body: options?.request?.body ?? options?.input,
        raw: options?.request?.raw,
      };
      const resolvedContext = await resolveContext(contextFactory, request);
      const input = parseMaybe<SchemaInput<TInputSchema>>(config.input, options?.input);
      const runtimeContext: QueryRuntimeContext<TContext, TAuth> = {
        request,
        auth: null,
        locals: {},
        setCacheTtl: () => undefined,
        ...resolvedContext,
        ...(options?.context ?? {}),
      };
      const result = await run({
        input,
        ctx: runtimeContext,
      });

      return parseMaybe<TResult>(config.output, result);
    },
    ...(config.input && { inputSchema: config.input }),
    ...(config.output && { outputSchema: config.output }),
    ...(config.method && { method: config.method }),
    ...(config.name && { name: config.name }),
    ...(config.description && { description: config.description }),
    ...(config.summary && { summary: config.summary }),
    ...(config.tags && { tags: config.tags }),
    ...(typeof config.auth !== "undefined" && { auth: config.auth }),
    ...(typeof config.requiresAuth !== "undefined" && { requiresAuth: config.requiresAuth }),
    ...(typeof config.tenant !== "undefined" && { tenant: config.tenant }),
    ...(typeof config.cacheTtlMs !== "undefined" && { cacheTtlMs: config.cacheTtlMs }),
    ...(config.requiredRoles && { requiredRoles: config.requiredRoles }),
    ...(config.requiredScopes && { requiredScopes: config.requiredScopes }),
    ...(config.custom && { custom: config.custom }),
  };

  return definition as StandaloneQueryDefinition<TInputSchema, TOutputSchema extends ZodTypeAny ? TOutputSchema : ZodTypeAny, TContext, TAuth, TResult>;
};

export const createQueryFactory = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
>(
  contextFactory?: ServeContextFactory<TContext, TAuth>,
) => {
  return <
    TInputSchema extends ZodTypeAny | undefined = undefined,
    TOutputSchema extends ZodTypeAny | undefined = undefined,
    TResult = TOutputSchema extends ZodTypeAny ? SchemaOutput<TOutputSchema> : unknown
  >(
    config: QueryObjectConfig<TInputSchema, TOutputSchema, TContext, TAuth, TResult>,
  ): StandaloneQueryDefinition<
    TInputSchema,
    TOutputSchema extends ZodTypeAny ? TOutputSchema : ZodTypeAny,
    TContext,
    TAuth,
    TResult
  > => {
    return createStandaloneQuery(config, contextFactory);
  };
};

/**
 * Create a reusable query definition that can execute in-process or be served via HTTP.
 *
 * Use `initServe()` when you want shared context passed once for both local execution and HTTP wiring.
 */
export const query = createQueryFactory();

/**
 * Create a Serve API from a queries map.
 *
 * This is the unbound version. Use `initServe().serve(...)` when you want shared context and config.
 */
export function serve<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
>(config: ServeConfig<TContext, TAuth, TQueries>): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth> {
  return defineServe<TContext, TAuth, TQueries>(config);
}
