import type { ZodTypeAny } from "zod";
import type { ServeQueryLogger, ServeQueryEventCallback, ServeQueryEvent } from "./query-logger.js";

/** Supported HTTP verbs for serve-managed endpoints. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type HeaderMap = Record<string, string | undefined>;
export type QueryParams = Record<string, string | string[] | undefined>;

export interface ServeRequest<TBody = unknown> {
  method: HttpMethod;
  path: string;
  query: QueryParams;
  headers: HeaderMap;
  body?: TBody;
  /** Raw underlying request (IncomingMessage, Request, etc.) */
  raw?: unknown;
}

export interface ServeResponse<TData = unknown> {
  status: number;
  headers?: Record<string, string>;
  body: TData;
}

export type ServeHandler = (request: ServeRequest) => Promise<ServeResponse<unknown>>;

export type ServeErrorType =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "QUERY_FAILURE"
  | "CLICKHOUSE_UNREACHABLE"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

export interface ErrorEnvelope {
  error: {
    type: ServeErrorType;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ServeError extends Error {
  status: number;
  payload: ErrorEnvelope["error"];
  cause?: unknown;
}

export type EndpointVisibility = "public" | "internal" | "private";

export interface EndpointMetadata<TCustom = Record<string, unknown>> {
  path: string;
  method: HttpMethod;
  name?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  requiresAuth?: boolean;
  /** Roles required to access this endpoint. Implies requiresAuth. */
  requiredRoles?: string[];
  /** Scopes required to access this endpoint. Implies requiresAuth. */
  requiredScopes?: string[];
  cacheTtlMs?: number | null;
  visibility: EndpointVisibility;
  /** Custom metadata fields for application-specific use cases */
  custom?: TCustom;
}

export interface AuthContext {
  userId?: string;
  roles?: string[];
  scopes?: string[];
  tenantId?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Configuration for multi-tenant query isolation.
 * Automatically enforces tenant-scoped data access.
 */
export interface TenantConfig<TAuth extends AuthContext = AuthContext> {
  /**
   * Function to extract the tenant ID from the auth context.
   * @example
   * extract: (auth) => auth.tenantId
   * extract: (auth) => auth.organizationId
   */
  extract: (auth: TAuth) => string | null | undefined;

  /**
   * Whether tenant context is required.
   * If true, requests without a valid tenant ID will be rejected.
   * @default true
   */
  required?: boolean;

  /**
   * Column name for tenant filtering (e.g., 'organization_id', 'tenant_id').
   * When specified with mode='auto-inject', provides tenant-scoped query helpers.
   * @example
   * column: 'organization_id'
   */
  column?: string;

  /**
   * Tenant isolation mode.
   * - 'auto-inject': Provides tenant-scoped query helpers in context (recommended)
   * - 'manual': Developer must manually filter queries (for complex cases)
   * @default 'manual'
   */
  mode?: 'auto-inject' | 'manual';

  /**
   * Custom error message when tenant validation fails.
   */
  errorMessage?: string;
}

export interface AuthStrategyContext {
  request: ServeRequest;
  endpoint?: EndpointMetadata;
}

export type AuthStrategy<TAuth extends AuthContext = AuthContext> = (
  context: AuthStrategyContext
) => Promise<TAuth | null>;

export type EndpointContext<
  TInput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = QueryRuntimeContext<TContext, TAuth> & {
    input: TInput;
    metadata: EndpointMetadata;
    /** Extracted tenant ID if tenant config is enabled */
    tenantId?: string;
  };

export type EndpointHandler<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = (ctx: EndpointContext<TInput, TContext, TAuth>) => Promise<TResult>;

export type ServeMiddleware<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = (
  ctx: EndpointContext<TInput, TContext, TAuth>,
  next: () => Promise<TResult>
) => Promise<TResult>;

export type SchemaInput<T extends ZodTypeAny | undefined> = T extends ZodTypeAny
  ? T["_input"]
  : unknown;
export type SchemaOutput<T extends ZodTypeAny | undefined> = T extends ZodTypeAny
  ? T["_output"]
  : unknown;

type ExtractServeQueries<
  TTarget,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = TTarget extends ServeBuilder<infer TQueries, any, any>
  ? TQueries
  : TTarget extends ServeQueriesMap<TContext, TAuth>
    ? TTarget
    : never;

type ServeQueryEntry<TTarget, TKey extends keyof ExtractServeQueries<TTarget, any, any>> =
  ExtractServeQueries<TTarget, any, any>[TKey];

export type InferExecutableQueryResult<TExecutable> = TExecutable extends QueryResolver<
  any,
  infer TResult,
  any,
  any
>
  ? Awaited<TResult>
  : TExecutable extends { run: QueryResolver<any, infer TResult, any, any> }
    ? Awaited<TResult>
    : never;

export type InferQueryInput<
  TTarget,
  TKey extends keyof ExtractServeQueries<TTarget, any, any>
> = SchemaInput<ServeQueryEntry<TTarget, TKey>["inputSchema"]>;

export type InferQueryOutput<
  TTarget,
  TKey extends keyof ExtractServeQueries<TTarget, any, any>
> = SchemaOutput<ServeQueryEntry<TTarget, TKey>["outputSchema"]>;

export type InferQueryResult<
  TTarget,
  TKey extends keyof ExtractServeQueries<TTarget, any, any>
> = InferExecutableQueryResult<ServeQueryEntry<TTarget, TKey>["query"]>;

/**
 * Infer the API type from a ServeBuilder for use with @hypequery/react.
 *
 * @example
 * const api = define({ queries: { hello: ... } });
 * type Api = InferApiType<typeof api>;
 * createHooks<Api>({ baseUrl: '/api' });
 */
export type InferApiType<TTarget> = TTarget extends ServeBuilder<infer TQueries, any, any>
  ? {
      [K in keyof TQueries]: TQueries[K] extends ServeEndpoint<
        infer TInputSchema,
        infer TOutputSchema,
        any,
        any,
        any
      >
        ? {
            input: SchemaInput<TInputSchema>;
            output: SchemaOutput<TOutputSchema>;
          }
        : never;
    }
  : never;

export type QueryRuntimeContext<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = {
  request: ServeRequest;
  auth: TAuth | null;
  locals: Record<string, unknown>;
  setCacheTtl: (ttlMs: number | null) => void;
} & TContext;

export interface QueryResolverArgs<
  TInput = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> {
  input: TInput;
  ctx: QueryRuntimeContext<TContext, TAuth>;
}

export type QueryResolver<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = (args: QueryResolverArgs<TInput, TContext, TAuth>) => Promise<TResult>;

type QueryWrapper<TInput, TResult, TContext extends Record<string, unknown>, TAuth extends AuthContext> =
  | QueryResolver<TInput, TResult, TContext, TAuth>
  | {
      run: QueryResolver<TInput, TResult, TContext, TAuth>;
      describe?: () => string;
    };

export type ExecutableQuery<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = QueryWrapper<TInput, TResult, TContext, TAuth>;

export interface ServeEndpoint<
  TInputSchema extends ZodTypeAny | undefined = undefined,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TResult = SchemaOutput<TOutputSchema>
> {
  key: string;
  method: HttpMethod;
  inputSchema?: TInputSchema;
  outputSchema: TOutputSchema;
  handler: EndpointHandler<
    SchemaInput<TInputSchema>,
    TResult,
    TContext,
    TAuth
  >;
  query?: ExecutableQuery<SchemaInput<TInputSchema>, TResult, TContext, TAuth>;
  middlewares: ServeMiddleware<
    SchemaInput<TInputSchema>,
    SchemaOutput<TOutputSchema>,
    TContext,
    TAuth
  >[];
  auth?: AuthStrategy<TAuth> | null;
  tenant?: TenantConfig<TAuth>;
  metadata: EndpointMetadata;
  cacheTtlMs?: number | null;
  defaultHeaders?: Record<string, string>;
  /** Roles required to access this endpoint. Checked after authentication. */
  requiredRoles?: string[];
  /** Scopes required to access this endpoint. Checked after authentication. */
  requiredScopes?: string[];
}


export type ServeEndpointResult<
  TEndpoint extends ServeEndpoint<any, any, any, any>
> = TEndpoint extends ServeEndpoint<any, any, any, any, infer TResult> ? TResult : never;

export interface ServeQueryConfig<
  TInputSchema extends ZodTypeAny | undefined = undefined,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TResult = SchemaOutput<TOutputSchema>
> {
  key?: string;
  query: ExecutableQuery<SchemaInput<TInputSchema>, TResult, TContext, TAuth>;
  method?: HttpMethod;
  name?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  middlewares?: ServeMiddleware<
    SchemaInput<TInputSchema>,
    SchemaOutput<TOutputSchema>,
    TContext,
    TAuth
  >[];
  auth?: AuthStrategy<TAuth> | null;
  /** Explicitly set whether authentication is required. Set by .requireAuth() or .public(). */
  requiresAuth?: boolean;
  tenant?: TenantConfig<TAuth>;
  cacheTtlMs?: number | null;
  /** Roles required to access this endpoint. Checked after authentication. */
  requiredRoles?: string[];
  /** Scopes required to access this endpoint. Checked after authentication. */
  requiredScopes?: string[];
  /** Custom metadata for application-specific use cases */
  custom?: Record<string, unknown>;
}

export type ServeQueriesMap<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> = Record<string, ServeQueryConfig<any, any, TContext, TAuth>>;

export type ServeEndpointMap<
  TQueries extends ServeQueriesMap<TContext, TAuth>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> = {
  [TKey in keyof TQueries]: TQueries[TKey] extends ServeQueryConfig<
    infer TInputSchema,
    infer TOutputSchema,
    TContext,
    TAuth,
    infer TResult
  >
    ? ServeEndpoint<TInputSchema, TOutputSchema, TContext, TAuth, TResult>
    : ServeEndpoint<any, any, TContext, TAuth>;
};

export interface DocsOptions {
  enabled?: boolean;
  path?: string;
  title?: string;
  subtitle?: string;
  darkMode?: boolean;
}

export interface OpenApiOptions {
  enabled?: boolean;
  path?: string;
  version?: string;
  info?: {
    title: string;
    description?: string;
    termsOfService?: string;
    contact?: {
      name?: string;
      url?: string;
      email?: string;
    };
    license?: {
      name: string;
      url?: string;
    };
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    termsOfService?: string;
    contact?: {
      name?: string;
      url?: string;
      email?: string;
    };
    license?: {
      name: string;
      url?: string;
    };
  };
  servers: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
}

export interface ServeConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
  TQueries extends ServeQueriesMap<TContext, TAuth> = ServeQueriesMap<TContext, TAuth>
> {
  queries: TQueries;
  basePath?: string;
  middlewares?: ServeMiddleware<any, any, TContext, TAuth>[];
  auth?: AuthStrategy<TAuth> | AuthStrategy<TAuth>[];
  /** Global tenant configuration applied to all queries (can be overridden per-query) */
  tenant?: TenantConfig<TAuth>;
  docs?: DocsOptions;
  openapi?: OpenApiOptions;
  context?: ServeContextFactory<TContext, TAuth>;
  hooks?: ServeLifecycleHooks<TAuth>;
  /**
   * Enable query logging in production.
   * - `true` — logs to console in human-readable text format
   * - `'json'` — logs to console in structured JSON (for Datadog, CloudWatch, etc.)
   * - `(event) => void` — custom callback
   * - `false` / omitted — disabled (zero overhead)
   *
   * In development (`serveDev`), logging is always enabled regardless of this setting.
   */
  queryLogging?: boolean | 'json' | ServeQueryEventCallback;
  /**
   * Warn when a query takes longer than this many milliseconds.
   * Emits a console.warn with the endpoint key and duration.
   * Only applies when `queryLogging` is enabled.
   */
  slowQueryThreshold?: number;
}

export interface RouteRegistrationOptions<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> {
  method?: HttpMethod;
  name?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  middlewares?: ServeMiddleware<any, any, TContext, TAuth>[];
  requiresAuth?: boolean;
  visibility?: EndpointVisibility;
}

export interface StartServerOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  /** Whether to suppress internal logging. */
  quiet?: boolean;
}

/**
 * Type-safe function signature for executing queries programmatically.
 * Used internally by the serve builder for direct query execution.
 */
export type ExecuteQueryFunction<
  TQueries extends Record<string, ServeEndpoint<any, any, any, any>>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> = <TKey extends keyof TQueries>(
  key: TKey,
  options?: {
    input?: SchemaInput<TQueries[TKey]["inputSchema"]>;
    context?: Partial<TContext>;
    request?: Partial<ServeRequest>;
  }
) => Promise<ServeEndpointResult<TQueries[TKey]>>;

export interface ServeBuilder<
  TQueries extends Record<string, ServeEndpoint<any, any, any, any>> = Record<
    string,
    ServeEndpoint<any, any, any, any>
  >,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> {
  readonly queries: TQueries;
  /** Serve-layer query logger for subscribing to endpoint execution events */
  readonly queryLogger: ServeQueryLogger;
  /** Internal route configuration mapping query names to their HTTP methods */
  readonly _routeConfig?: Record<string, { method: HttpMethod }>;
  route<Path extends string, TKey extends keyof TQueries>(
    path: Path,
    endpoint: TQueries[TKey],
    options?: Partial<RouteRegistrationOptions<TContext, TAuth>>
  ): this;
  use(middleware: ServeMiddleware<any, any, TContext, TAuth>): this;
  useAuth(strategy: AuthStrategy<TAuth>): this;
  execute<TKey extends keyof TQueries>(
    key: TKey,
    options?: {
      input?: SchemaInput<TQueries[TKey]["inputSchema"]>;
      context?: Partial<TContext>;
      request?: Partial<ServeRequest>;
    }
  ): Promise<ServeEndpointResult<TQueries[TKey]>>;
  run<TKey extends keyof TQueries>(
    key: TKey,
    options?: {
      input?: SchemaInput<TQueries[TKey]["inputSchema"]>;
      context?: Partial<TContext>;
      request?: Partial<ServeRequest>;
    }
  ): Promise<ServeEndpointResult<TQueries[TKey]>>;
  describe(): ToolkitDescription;
  handler: ServeHandler;
  start(options?: StartServerOptions): Promise<ServeStartResult>;
}

export interface ServeInitializer<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
> {
  readonly procedure: QueryProcedureBuilder<TContext, TAuth>;
  readonly query: QueryProcedureBuilder<TContext, TAuth>;
  queries<TQueries extends ServeQueriesMap<TContext, TAuth>>(queries: TQueries): TQueries;
  define<TQueries extends ServeQueriesMap<TContext, TAuth>>(
    config: Omit<ServeConfig<TContext, TAuth, TQueries>, "context">
  ): ServeBuilder<ServeEndpointMap<TQueries, TContext, TAuth>, TContext, TAuth>;
}

export interface QueryProcedureBuilder<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext,
  TInputSchema extends ZodTypeAny | undefined = undefined,
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  input<TNewInputSchema extends ZodTypeAny>(
    schema: TNewInputSchema
  ): QueryProcedureBuilder<TContext, TAuth, TNewInputSchema, TOutputSchema>;
  output<TNewOutputSchema extends ZodTypeAny>(
    schema: TNewOutputSchema
  ): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TNewOutputSchema>;
  describe(description: string): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  name(name: string): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  summary(summary: string): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  tag(tag: string): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  tags(tags: string[]): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  method(method: HttpMethod): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  cache(ttlMs: number | null): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  auth(strategy: AuthStrategy<TAuth> | null): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  /**
   * Require authentication for this endpoint.
   * Equivalent to setting requiresAuth: true, but more explicit in the builder chain.
   */
  requireAuth(): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  /**
   * Require the authenticated user to have at least one of the specified roles.
   * Implies requireAuth(). Returns 403 if the user lacks the required role.
   * @example query.requireRole('admin', 'editor').query(...)
   */
  requireRole(...roles: string[]): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  /**
   * Require the authenticated user to have all of the specified scopes.
   * Implies requireAuth(). Returns 403 if the user lacks a required scope.
   * @example query.requireScope('read:metrics', 'read:users').query(...)
   */
  requireScope(...scopes: string[]): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  /**
   * Explicitly mark this endpoint as public (no auth required).
   * Overrides global auth strategies for this endpoint.
   */
  public(): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  tenant(config: TenantConfig<TAuth>): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  custom(custom: Record<string, unknown>): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  use(
    ...middlewares: ServeMiddleware<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TContext, TAuth>[]
  ): QueryProcedureBuilder<TContext, TAuth, TInputSchema, TOutputSchema>;
  query<TExecutable extends ExecutableQuery<SchemaInput<TInputSchema>, any, TContext, TAuth>>(
    executable: TExecutable
  ): ServeQueryConfig<
    TInputSchema,
    TOutputSchema,
    TContext,
    TAuth,
    InferExecutableQueryResult<TExecutable>
  >;
}

export interface RequestLifecycleBase<TAuth extends AuthContext = AuthContext> {
  requestId: string;
  queryKey: string;
  metadata: EndpointMetadata;
  request: ServeRequest;
  auth: TAuth | null;
}

export interface RequestStartEvent<TAuth extends AuthContext = AuthContext>
  extends RequestLifecycleBase<TAuth> {}

export interface RequestEndEvent<TAuth extends AuthContext = AuthContext>
  extends RequestLifecycleBase<TAuth> {
  durationMs: number;
  result: unknown;
}

export interface RequestErrorEvent<TAuth extends AuthContext = AuthContext>
  extends RequestLifecycleBase<TAuth> {
  durationMs: number;
  error: unknown;
}

export interface AuthFailureEvent<TAuth extends AuthContext = AuthContext>
  extends RequestLifecycleBase<TAuth> {
  reason: "MISSING" | "INVALID";
}

export interface AuthorizationFailureEvent<TAuth extends AuthContext = AuthContext>
  extends RequestLifecycleBase<TAuth> {
  reason: "MISSING_ROLE" | "MISSING_SCOPE";
  required: string[];
  actual: string[];
}

export interface ServeLifecycleHooks<TAuth extends AuthContext = AuthContext> {
  onRequestStart?: (event: RequestStartEvent<TAuth>) => MaybePromise<void>;
  onRequestEnd?: (event: RequestEndEvent<TAuth>) => MaybePromise<void>;
  onError?: (event: RequestErrorEvent<TAuth>) => MaybePromise<void>;
  onAuthFailure?: (event: AuthFailureEvent<TAuth>) => MaybePromise<void>;
  onAuthorizationFailure?: (event: AuthorizationFailureEvent<TAuth>) => MaybePromise<void>;
}

export interface ToolkitDescription {
  basePath?: string;
  queries: Array<ToolkitQueryDescription>;
}

export interface ToolkitQueryDescription {
  key: string;
  path: string;
  method: HttpMethod;
  name?: string;
  summary?: string;
  description?: string;
  tags: string[];
  visibility: EndpointVisibility;
  requiresAuth: boolean;
  requiresTenant?: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
  custom?: Record<string, unknown>;
}

export interface EndpointRegistry {
  list(): ServeEndpoint<any, any, any, any>[];
  register(endpoint: ServeEndpoint<any, any, any, any>): void;
  match(method: HttpMethod, path: string): ServeEndpoint<any, any, any, any> | null;
}

export interface ServeStartResult {
  stop(): Promise<void>;
}

export type FetchHandler = (request: Request) => Promise<Response>;

export type MaybePromise<T> = Promise<T> | T;

export type ServeContextFactory<
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
> =
  | TContext
  | ((options: { request: ServeRequest; auth: TAuth | null }) => MaybePromise<TContext>);
