import type { ZodTypeAny } from 'zod';

import type {
  AuthContext,
  AuthStrategy,
  QueryProcedureBuilder,
  SchemaInput,
  SchemaOutput,
  ServeMiddleware,
  ServeQueryConfig,
  HttpMethod,
  ExecutableQuery,
  InferExecutableQueryResult,
  TenantConfigOverride,
} from './types.js';
import { mergeTags } from './utils.js';

interface BuilderState<TContext extends Record<string, unknown>, TAuth extends AuthContext> {
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  description?: string;
  name?: string;
  summary?: string;
  tags: string[];
  method?: HttpMethod;
  cacheTtlMs?: number | null;
  auth?: AuthStrategy<TAuth> | null;
  requiresAuth?: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  tenant?: TenantConfigOverride<TAuth>;
  custom?: Record<string, unknown>;
  middlewares: ServeMiddleware<any, any, TContext, TAuth>[];
}

const defaultState = <TContext extends Record<string, unknown>, TAuth extends AuthContext>(): BuilderState<TContext, TAuth> => ({
  tags: [],
  middlewares: [],
});

export const createProcedureBuilder = <
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(): QueryProcedureBuilder<TContext, TAuth> => {
  const build = <
    TInputSchema extends ZodTypeAny | undefined,
    TOutputSchema extends ZodTypeAny
  >(
    state: BuilderState<TContext, TAuth>
  ): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema> => ({
    input: <TNewInputSchema extends ZodTypeAny>(schema: TNewInputSchema) =>
      build<TNewInputSchema, TOutputSchema>({ ...state, inputSchema: schema }),
    output: <TNewOutputSchema extends ZodTypeAny>(schema: TNewOutputSchema) =>
      build<TInputSchema, TNewOutputSchema>({ ...state, outputSchema: schema }),
    describe: (description) => build<TInputSchema, TOutputSchema>({ ...state, description }),
    name: (name) => build<TInputSchema, TOutputSchema>({ ...state, name }),
    summary: (summary) => build<TInputSchema, TOutputSchema>({ ...state, summary }),
    tag: (tag) => build<TInputSchema, TOutputSchema>({ ...state, tags: mergeTags(state.tags, [tag]) }),
    tags: (tags) => build<TInputSchema, TOutputSchema>({ ...state, tags: mergeTags(state.tags, tags) }),
    method: (method) => build<TInputSchema, TOutputSchema>({ ...state, method }),
    cache: (ttlMs) => build<TInputSchema, TOutputSchema>({ ...state, cacheTtlMs: ttlMs }),
    auth: (strategy) => build<TInputSchema, TOutputSchema>({ ...state, auth: strategy }),
    requireAuth: () => build<TInputSchema, TOutputSchema>({ ...state, requiresAuth: true }),
    require: () => build<TInputSchema, TOutputSchema>({ ...state, requiresAuth: true }),
    requireRole: (...roles) => build<TInputSchema, TOutputSchema>({
      ...state,
      requiresAuth: true,
      requiredRoles: [...(state.requiredRoles ?? []), ...roles],
    }),
    requireScope: (...scopes) => build<TInputSchema, TOutputSchema>({
      ...state,
      requiresAuth: true,
      requiredScopes: [...(state.requiredScopes ?? []), ...scopes],
    }),
    public: () => build<TInputSchema, TOutputSchema>({ ...state, requiresAuth: false }),
    tenant: (config) => build<TInputSchema, TOutputSchema>({ ...state, tenant: config }),
    tenantOptional: (config) => build<TInputSchema, TOutputSchema>({
      ...state,
      tenant: { ...(state.tenant ?? {}), ...(config ?? {}), required: false },
    }),
    custom: (custom) => build<TInputSchema, TOutputSchema>({ ...state, custom: { ...(state.custom ?? {}), ...custom } }),
    use: (...middlewares) =>
      build<TInputSchema, TOutputSchema>({ ...state, middlewares: [...state.middlewares, ...middlewares] }),
    query: <TExecutable extends ExecutableQuery<SchemaInput<TInputSchema>, any, TContext, TAuth>>(executable: TExecutable) => {
      type TResult = InferExecutableQueryResult<TExecutable>;
      const config: ServeQueryConfig<TInputSchema, TOutputSchema, TContext, TAuth, TResult> = {
        description: state.description,
        name: state.name,
        summary: state.summary,
        tags: state.tags,
        method: state.method,
        inputSchema: state.inputSchema as TInputSchema,
        outputSchema: state.outputSchema as TOutputSchema,
        cacheTtlMs: state.cacheTtlMs,
        auth: typeof state.auth === 'undefined' ? null : state.auth,
        requiresAuth: state.requiresAuth,
        tenant: state.tenant,
        requiredRoles: state.requiredRoles,
        requiredScopes: state.requiredScopes,
        custom: state.custom,
        middlewares: state.middlewares as ServeMiddleware<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TContext, TAuth>[],
        query: executable,
      };
      return config;
    },
  });

  return build(defaultState());
};
