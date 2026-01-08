import type { ZodTypeAny } from "zod";

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

export interface EndpointMetadata {
  path: string;
  method: HttpMethod;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  requiresAuth?: boolean;
  cacheTtlMs?: number | null;
  visibility: EndpointVisibility;
}

export interface AuthContext {
  user?: unknown;
  apiKey?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AuthStrategyContext {
  request: ServeRequest;
  endpoint?: EndpointMetadata;
}

export type AuthStrategy<TAuth extends AuthContext = AuthContext> = (
  context: AuthStrategyContext
) => Promise<TAuth | null>;

export type EndpointContext<TInput = unknown, TAuth extends AuthContext = AuthContext> =
  QueryRuntimeContext<TAuth> & {
    input: TInput;
    metadata: EndpointMetadata;
  };

export type EndpointHandler<
  TInput = unknown,
  TResult = unknown,
  TAuth extends AuthContext = AuthContext
> = (ctx: EndpointContext<TInput, TAuth>) => Promise<TResult>;

export type ServeMiddleware<
  TInput = unknown,
  TResult = unknown,
  TAuth extends AuthContext = AuthContext
> = (
  ctx: EndpointContext<TInput, TAuth>,
  next: () => Promise<TResult>
) => Promise<TResult>;

export type SchemaInput<T extends ZodTypeAny | undefined> = T extends ZodTypeAny
  ? T["_input"]
  : unknown;
export type SchemaOutput<T extends ZodTypeAny | undefined> = T extends ZodTypeAny
  ? T["_output"]
  : unknown;

export type QueryRuntimeContext<TAuth extends AuthContext = AuthContext> = {
  request: ServeRequest;
  auth: TAuth | null;
  locals: Record<string, unknown>;
  setCacheTtl: (ttlMs: number | null) => void;
} & Record<string, unknown>;

export interface QueryResolverArgs<
  TInput = unknown,
  TAuth extends AuthContext = AuthContext
> {
  input: TInput;
  ctx: QueryRuntimeContext<TAuth>;
}

export type QueryResolver<
  TInput = unknown,
  TResult = unknown,
  TAuth extends AuthContext = AuthContext
> = (args: QueryResolverArgs<TInput, TAuth>) => Promise<TResult>;

export type LegacyQueryResolver<
  TInput = unknown,
  TResult = unknown,
  TAuth extends AuthContext = AuthContext
> = (params: TInput, ctx: QueryRuntimeContext<TAuth>) => Promise<TResult>;

export type ExecutableQuery<
  TInput = unknown,
  TResult = unknown,
  TAuth extends AuthContext = AuthContext
> =
  | QueryResolver<TInput, TResult, TAuth>
  | LegacyQueryResolver<TInput, TResult, TAuth>
  | {
      run:
        | QueryResolver<TInput, TResult, TAuth>
        | LegacyQueryResolver<TInput, TResult, TAuth>;
      describe?: () => string;
    };

export interface ServeEndpoint<
  TInputSchema extends ZodTypeAny | undefined = undefined,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TAuth extends AuthContext = AuthContext
> {
  key: string;
  method: HttpMethod;
  inputSchema?: TInputSchema;
  outputSchema: TOutputSchema;
  handler: EndpointHandler<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TAuth>;
  query?: ExecutableQuery<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TAuth>;
  middlewares: ServeMiddleware<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TAuth>[];
  auth?: AuthStrategy<TAuth> | null;
  metadata: EndpointMetadata;
  cacheTtlMs?: number | null;
  defaultHeaders?: Record<string, string>;
}

export interface ServeQueryConfig<
  TInputSchema extends ZodTypeAny | undefined = undefined,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TAuth extends AuthContext = AuthContext
> {
  key?: string;
  query: ExecutableQuery<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TAuth>;
  method?: HttpMethod;
  summary?: string;
  description?: string;
  tags?: string[];
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  middlewares?: ServeMiddleware<SchemaInput<TInputSchema>, SchemaOutput<TOutputSchema>, TAuth>[];
  auth?: AuthStrategy<TAuth> | null;
  cacheTtlMs?: number | null;
}

export type ServeQueriesMap = Record<
  string,
  ServeQueryConfig<any, any, any> | ExecutableQuery<any, any, any>
>;

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

export interface SdkGeneratorOptions {
  enabled?: boolean;
  outputPath?: string;
  clientName?: string;
  runtime?: "fetch" | "axios";
}

export interface ServeConfig<
  TQueries extends ServeQueriesMap = ServeQueriesMap,
  TAuth extends AuthContext = AuthContext
> {
  queries: TQueries;
  basePath?: string;
  middlewares?: ServeMiddleware<any, any, TAuth>[];
  auth?: AuthStrategy<TAuth> | AuthStrategy<TAuth>[];
  docs?: DocsOptions;
  openapi?: OpenApiOptions;
  sdk?: SdkGeneratorOptions;
  context?: ServeContextFactory<TAuth>;
}

export interface RouteRegistrationOptions {
  method?: HttpMethod;
  summary?: string;
  description?: string;
  tags?: string[];
  middlewares?: ServeMiddleware<any, any, any>[];
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

export interface ServeBuilder<
  TQueries extends Record<string, ServeEndpoint<any, any, any>> = Record<
    string,
    ServeEndpoint<any, any, any>
  >,
  TAuth extends AuthContext = AuthContext
> {
  readonly queries: TQueries;
  route<Path extends string, TKey extends keyof TQueries>(
    path: Path,
    endpoint: TQueries[TKey],
    options?: Partial<RouteRegistrationOptions>
  ): this;
  use(middleware: ServeMiddleware<any, any, TAuth>): this;
  useAuth(strategy: AuthStrategy<TAuth>): this;
  execute<TKey extends keyof TQueries>(
    key: TKey,
    options?: {
      input?: SchemaInput<TQueries[TKey]["inputSchema"]>;
      context?: Record<string, unknown>;
      request?: Partial<ServeRequest>;
    }
  ): Promise<SchemaOutput<TQueries[TKey]["outputSchema"]>>;
  describe(): ToolkitDescription;
  handler: ServeHandler;
  start(options?: StartServerOptions): Promise<ServeStartResult>;
}

export interface ToolkitDescription {
  basePath?: string;
  queries: Array<ToolkitQueryDescription>;
}

export interface ToolkitQueryDescription {
  key: string;
  path: string;
  method: HttpMethod;
  summary?: string;
  description?: string;
  tags: string[];
  visibility: EndpointVisibility;
  requiresAuth: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface EndpointRegistry {
  list(): ServeEndpoint<any, any, any>[];
  register(endpoint: ServeEndpoint<any, any, any>): void;
  match(method: HttpMethod, path: string): ServeEndpoint<any, any, any> | null;
}

export interface ServeStartResult {
  stop(): Promise<void>;
}

export type FetchHandler = (request: Request) => Promise<Response>;

type MaybePromise<T> = Promise<T> | T;

export type ServeContextFactory<TAuth extends AuthContext> =
  | Record<string, unknown>
  | ((options: { request: ServeRequest; auth: TAuth | null }) => MaybePromise<Record<string, unknown>>);
